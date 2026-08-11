-- Corrige regressão: a migration 20260806000001 (que adicionou a coluna
-- codigo_peca em pedido_itens) recriou criar_pedido com uma assinatura de
-- 12 parâmetros (sem p_pagamentos_mistos) via CREATE OR REPLACE, sem o DROP
-- explícito da assinatura de 13 parâmetros que 20260721000018 já tinha
-- deixado avisado como obrigatório ao trocar a lista de parâmetros. Como as
-- assinaturas são diferentes, Postgres não substituiu a função — criou um
-- SEGUNDO overload. `pedidos.ts` sempre manda a chave `p_pagamentos_mistos`
-- (mesmo `null` quando a venda não é mista), então o PostgREST sempre
-- resolve pro overload de 13 parâmetros (o único que aceita essa chave) —
-- ou seja, toda venda desde 2026-08-06 está passando pela função ANTIGA,
-- que nunca grava `codigo_peca` em pedido_itens (a migration de backfill
-- 20260806000002 só corrigiu o passado, não o fluxo novo). Pagamento misto
-- em si não estava quebrado; o efeito real era `codigo_peca` ficando nulo
-- em toda venda nova. De qualquer forma, os dois overloads divergentes são
-- um risco (o de 12 parâmetros nem tinha o grant explícito pra
-- `authenticated`) — esta migration derruba os dois e deixa um único
-- `criar_pedido`, com pagamento misto E codigo_peca juntos.
--
-- ROLLBACK:
-- drop function if exists public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb);
-- -- (recriar as duas versões divergentes a partir de 20260721000018 e
-- -- 20260806000001 se precisar reverter — não recomendado, era o estado
-- -- quebrado que esta migration corrige)

drop function if exists public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb);
drop function if exists public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text);

create or replace function public.criar_pedido(
  p_cliente_id uuid,
  p_forma_pagamento public.forma_pagamento,
  p_status public.status_pedido,
  p_itens jsonb,
  p_valor_desconto numeric default 0,
  p_percentual_desconto numeric default null,
  p_valor_acrescimo numeric default 0,
  p_percentual_acrescimo numeric default null,
  p_parcelas jsonb default null,
  p_idempotency_key uuid default null,
  p_parcelas_planejadas jsonb default null,
  p_excecao_justificativa text default null,
  p_pagamentos_mistos jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2) := 0;
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade integer;
  v_preco_unitario numeric(10, 2);
  v_estoque_atual integer;
  v_nome_produto text;
  v_parcela jsonb;
  v_valor_parcela numeric(10, 2);
  v_soma_parcelas numeric(10, 2) := 0;
  v_numero_parcelas integer := coalesce(jsonb_array_length(p_parcelas), 0);
  v_indice integer := 0;
  v_stats record;
  v_minimo numeric(10, 2) := 0;
  v_motivo_minimo text := null;
  v_permissao_necessaria public.permissao_especial;
  v_vendedor record;
  v_valor_comissao numeric(10, 2);
  v_pagamento jsonb;
  v_soma_pagamentos numeric(10, 2) := 0;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_idempotency_key is not null then
    select id into v_pedido_id from public.pedidos where idempotency_key = p_idempotency_key;
    if v_pedido_id is not null then
      return v_pedido_id;
    end if;
  end if;

  if p_status not in ('orcamento', 'faturado', 'aguardando_lancamento_gmax') then
    raise exception 'Status inicial inválido: use orcamento, faturado ou aguardando_lancamento_gmax.';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa de pelo menos um item.';
  end if;

  if coalesce(p_valor_desconto, 0) < 0 then
    raise exception 'Desconto não pode ser negativo.';
  end if;
  if coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Acréscimo não pode ser negativo — um acréscimo negativo funcionaria como desconto não auditado.';
  end if;

  if p_forma_pagamento = 'misto' and (p_pagamentos_mistos is null or jsonb_array_length(p_pagamentos_mistos) = 0) then
    raise exception 'Pagamento misto precisa de pelo menos duas formas de pagamento informadas.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_preco_unitario := (v_item ->> 'preco_unitario')::numeric;
    if v_preco_unitario < 0 then
      raise exception 'Preço unitário não pode ser negativo.';
    end if;
    v_subtotal := v_subtotal + (v_item ->> 'quantidade')::integer * v_preco_unitario;
  end loop;

  v_total := v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0);
  if v_total < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  if p_forma_pagamento = 'misto' then
    for v_pagamento in select * from jsonb_array_elements(p_pagamentos_mistos)
    loop
      if (v_pagamento ->> 'valor')::numeric <= 0 then
        raise exception 'Cada perna do pagamento misto precisa ter valor maior que zero.';
      end if;
      v_soma_pagamentos := v_soma_pagamentos + (v_pagamento ->> 'valor')::numeric;
    end loop;
    if abs(v_soma_pagamentos - v_total) > 0.01 then
      raise exception 'A soma das formas de pagamento (%) não bate com o total do pedido (%).',
        v_soma_pagamentos, v_total;
    end if;
  end if;

  if p_status in ('faturado', 'aguardando_lancamento_gmax') then
    select * into v_stats from public.estatisticas_cliente(p_cliente_id);

    if v_stats.data_primeira_compra is null then
      v_minimo := 1000;
      v_motivo_minimo := 'primeira compra';
      v_permissao_necessaria := 'liberar_primeira_compra_abaixo_minimo';
    elsif v_stats.meses_inatividade >= 12 then
      v_minimo := 800;
      v_motivo_minimo := 'reativação (12+ meses sem comprar)';
      v_permissao_necessaria := 'liberar_reativacao_abaixo_minimo';
    elsif v_stats.meses_inatividade >= 6 then
      v_minimo := 600;
      v_motivo_minimo := 'reativação (6-11 meses sem comprar)';
      v_permissao_necessaria := 'liberar_reativacao_abaixo_minimo';
    end if;

    if v_motivo_minimo is not null and v_total < v_minimo then
      if p_excecao_justificativa is null or length(trim(p_excecao_justificativa)) = 0 then
        raise exception 'Venda de % exige mínimo de % (valor atual: %). Informe uma justificativa de exceção autorizada pra liberar abaixo do mínimo.',
          v_motivo_minimo, v_minimo, v_total;
      end if;
      if not public.tem_permissao(v_permissao_necessaria) then
        raise exception 'Sem permissão para liberar % abaixo do mínimo de %.', v_motivo_minimo, v_minimo;
      end if;
    end if;
  end if;

  if p_status = 'faturado' and v_numero_parcelas > 0 then
    for v_parcela in select * from jsonb_array_elements(p_parcelas)
    loop
      v_valor_parcela := (v_parcela ->> 'valor')::numeric;
      if v_valor_parcela <= 0 then
        raise exception 'Valor de parcela precisa ser maior que zero.';
      end if;
      v_soma_parcelas := v_soma_parcelas + v_valor_parcela;
    end loop;

    if abs(v_soma_parcelas - v_total) > 0.01 then
      raise exception 'A soma das parcelas (%) não bate com o total do pedido (%).',
        v_soma_parcelas, v_total;
    end if;
  end if;

  begin
    insert into public.pedidos (
      cliente_id, vendedor_id, status, forma_pagamento,
      subtotal, valor_desconto, percentual_desconto,
      valor_acrescimo, percentual_acrescimo, total, numero_parcelas,
      idempotency_key, parcelas_planejadas
    )
    values (
      p_cliente_id, auth.uid(), p_status, p_forma_pagamento,
      v_subtotal, coalesce(p_valor_desconto, 0), p_percentual_desconto,
      coalesce(p_valor_acrescimo, 0), p_percentual_acrescimo, v_total,
      greatest(1, v_numero_parcelas),
      p_idempotency_key, p_parcelas_planejadas
    )
    returning id into v_pedido_id;
  exception
    when unique_violation then
      select id into v_pedido_id from public.pedidos where idempotency_key = p_idempotency_key;
      return v_pedido_id;
  end;

  if v_motivo_minimo is not null and v_total < v_minimo then
    perform public.registrar_auditoria(
      'pedidos', v_pedido_id, 'excecao_' || replace(v_motivo_minimo, ' ', '_'),
      null, jsonb_build_object('total', v_total, 'minimo', v_minimo),
      p_excecao_justificativa
    );
  end if;

  if p_forma_pagamento = 'misto' then
    for v_pagamento in select * from jsonb_array_elements(p_pagamentos_mistos)
    loop
      insert into public.pedido_pagamentos_mistos (pedido_id, forma_pagamento, valor)
      values (v_pedido_id, (v_pagamento ->> 'forma')::public.forma_pagamento, (v_pagamento ->> 'valor')::numeric);
    end loop;
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_produto_id := (v_item ->> 'produto_id')::uuid;
    v_quantidade := (v_item ->> 'quantidade')::integer;
    v_preco_unitario := (v_item ->> 'preco_unitario')::numeric;

    insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, codigo_peca)
    values (v_pedido_id, v_produto_id, v_quantidade, v_preco_unitario, (v_item ->> 'codigo_peca')::numeric);

    if p_status = 'faturado' then
      select quantidade_estoque, nome into v_estoque_atual, v_nome_produto
        from public.produtos where id = v_produto_id for update;

      if v_estoque_atual is null then
        raise exception 'Produto não encontrado.';
      end if;
      if v_estoque_atual < v_quantidade then
        raise exception 'Estoque insuficiente para "%" (disponível: %, pedido: %).',
          v_nome_produto, v_estoque_atual, v_quantidade;
      end if;

      update public.produtos set quantidade_estoque = quantidade_estoque - v_quantidade
        where id = v_produto_id;

      insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo, pedido_id, criado_por)
      values (v_produto_id, 'saida', v_quantidade, 'Venda', v_pedido_id, auth.uid());
    end if;
  end loop;

  if p_status = 'faturado' and v_numero_parcelas > 0 then
    for v_parcela in select * from jsonb_array_elements(p_parcelas)
    loop
      v_indice := v_indice + 1;
      insert into public.contas_receber (
        pedido_id, cliente_id, valor, vencimento, forma_pagamento, numero_parcela, total_parcelas
      )
      values (
        v_pedido_id, p_cliente_id,
        (v_parcela ->> 'valor')::numeric,
        (v_parcela ->> 'vencimento')::date,
        p_forma_pagamento, v_indice, v_numero_parcelas
      );
    end loop;
  end if;

  if p_status = 'faturado' then
    select v.id, v.comissao_percentual, v.comissao_fixa
      into v_vendedor
      from public.vendedores v
      where v.profile_id = auth.uid() and v.evento_gerador = 'venda' and v.ativo;

    if v_vendedor.id is not null then
      v_valor_comissao := round(coalesce(v_total * coalesce(v_vendedor.comissao_percentual, 0) / 100, 0), 2)
        + coalesce(v_vendedor.comissao_fixa, 0);

      if v_valor_comissao > 0 then
        insert into public.comissoes_lancamentos (vendedor_id, pedido_id, evento, valor_base, valor_comissao)
        values (v_vendedor.id, v_pedido_id, 'venda', v_total, v_valor_comissao);
      end if;
    end if;
  end if;

  return v_pedido_id;
end;
$$;

revoke all on function public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb) from public;
grant execute on function public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb) to authenticated;

-- Mesmo backfill de 20260806000002, reaplicado: toda venda feita entre
-- 2026-08-06 (quando a coluna foi criada) e agora passou pelo overload
-- antigo (sem codigo_peca), então ficou de fora do backfill original.
-- Idempotente — só toca linha com codigo_peca ainda nulo.
update public.pedido_itens pi
set codigo_peca = round(pi.preco_unitario / p.multiplicador, 2)
from public.produtos p
where pi.produto_id = p.id
  and pi.codigo_peca is null
  and coalesce(p.usa_cotacao_diaria, false) = false
  and p.multiplicador > 0;
