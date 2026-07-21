-- Correções de code-review sobre criar_pedido v4 (achados reais do ângulo
-- line-by-line):
--   1. `p_valor_acrescimo` negativo nunca era validado — só o `v_total`
--      final era checado como não-negativo, então um acréscimo negativo
--      funcionava como um desconto extra silencioso e sem auditoria. Isso
--      também tinha um efeito real no cliente: no simulador de cartão com
--      juros (novo-pedido.tsx), digitar um "valor com juros" menor que o
--      total do carrinho gerava um `juroCartao` negativo enviado como
--      acréscimo, sem nenhum aviso.
--   2. A checagem de idempotência (select antes do insert) tinha uma
--      corrida real: duas requisições quase simultâneas com a mesma chave
--      podiam passar pelo select antes de qualquer uma commitar, e a
--      segunda batia num erro cru de violação de unique constraint em vez
--      de devolver o pedido já criado (o próprio objetivo documentado da
--      função). Fechado com um bloco de exceção pro unique_violation
--      especificamente no insert.
--
-- Assinatura idêntica à v4 (mesmos 12 parâmetros) — substitui em vez de
-- duplicar, sem precisar de DROP antes.
--
-- ROLLBACK:
-- (reverter pra v4 reintroduz os dois bugs acima — não há rollback seguro
-- específico pra esta migration; o corpo anterior está documentado em
-- 20260721000002_criar_pedido_v4_regras_pdv.sql pra referência histórica.)

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
  p_excecao_justificativa text default null
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
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  -- Idempotência: mesma chave já usada → devolve o pedido existente em vez
  -- de criar de novo (clique duplo, duas abas, retry de rede).
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

  -- Primeira compra / reativação (seção 10) — só se aplica a uma venda de
  -- verdade (faturado ou aguardando_lancamento_gmax), não a um orçamento.
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

  -- Parcelas em contas_receber só fazem sentido pra uma venda faturada de
  -- verdade — 'aguardando_lancamento_gmax' guarda o parcelamento em
  -- `parcelas_planejadas` (pro cupom/promissórias), não em contas_receber,
  -- já que essa venda ainda não afeta nosso financeiro real.
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

  -- Bloco isolado só pro insert: se duas requisições com a mesma
  -- idempotency_key passarem pelo select acima quase juntas (nenhuma tinha
  -- commitado ainda), a segunda a chegar aqui esbarra na unique constraint
  -- — em vez de deixar isso virar um erro cru pro usuário, recupera o
  -- pedido que a primeira já criou e devolve o id dele, exatamente como o
  -- caminho "achou no select" já faz.
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

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_produto_id := (v_item ->> 'produto_id')::uuid;
    v_quantidade := (v_item ->> 'quantidade')::integer;
    v_preco_unitario := (v_item ->> 'preco_unitario')::numeric;

    insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
    values (v_pedido_id, v_produto_id, v_quantidade, v_preco_unitario);

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

  return v_pedido_id;
end;
$$;
