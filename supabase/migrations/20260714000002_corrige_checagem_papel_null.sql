-- CORREÇÃO DE SEGURANÇA (achado real do code-review): "meu_papel() not in
-- ('admin','vendedor')" retorna NULL (não TRUE) quando meu_papel() é NULL —
-- e o IF do PL/pgSQL trata condição NULL como falsa, ou seja, a exceção NÃO
-- disparava e a função seguia em frente com privilégio total. Isso deixava
-- criar_pedido e extornar_pedido chamáveis por qualquer sessão sem perfil
-- (inclusive não-autenticada) sem barrar nada.
--
-- Também corrige, do mesmo code-review: parcelas (contas_receber) sendo
-- geradas mesmo pra 'orcamento' (deveria ser só em pedido faturado), e
-- adiciona uma checagem de reconciliação (soma das parcelas == total).

create or replace function public.assert_papel(p_papeis public.papel_usuario[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_papel public.papel_usuario;
begin
  v_papel := public.meu_papel();
  if v_papel is null or not (v_papel = any(p_papeis)) then
    raise exception 'Sem permissão para esta ação.';
  end if;
end;
$$;
revoke all on function public.assert_papel(public.papel_usuario[]) from public;
grant execute on function public.assert_papel(public.papel_usuario[]) to authenticated;

create or replace function public.criar_pedido(
  p_cliente_id uuid,
  p_forma_pagamento public.forma_pagamento,
  p_status public.status_pedido,
  p_itens jsonb,
  p_valor_desconto numeric default 0,
  p_percentual_desconto numeric default null,
  p_valor_acrescimo numeric default 0,
  p_percentual_acrescimo numeric default null,
  p_parcelas jsonb default null
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
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_status not in ('orcamento', 'faturado') then
    raise exception 'Status inicial inválido: use orcamento ou faturado.';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa de pelo menos um item.';
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

  -- Parcelas só fazem sentido pra uma venda de verdade — um orçamento é só
  -- uma cotação, não gera dívida real do cliente.
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

  insert into public.pedidos (
    cliente_id, vendedor_id, status, forma_pagamento,
    subtotal, valor_desconto, percentual_desconto,
    valor_acrescimo, percentual_acrescimo, total, numero_parcelas
  )
  values (
    p_cliente_id, auth.uid(), p_status, p_forma_pagamento,
    v_subtotal, coalesce(p_valor_desconto, 0), p_percentual_desconto,
    coalesce(p_valor_acrescimo, 0), p_percentual_acrescimo, v_total,
    greatest(1, v_numero_parcelas)
  )
  returning id into v_pedido_id;

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

create or replace function public.extornar_pedido(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.status_pedido;
  v_item record;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  select status into v_status from public.pedidos where id = p_pedido_id for update;
  if v_status is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Este pedido já está cancelado.';
  end if;

  if v_status = 'faturado' then
    for v_item in
      select produto_id, quantidade from public.pedido_itens where pedido_id = p_pedido_id
    loop
      update public.produtos
        set quantidade_estoque = quantidade_estoque + v_item.quantidade
        where id = v_item.produto_id;

      insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo, pedido_id, criado_por)
      values (v_item.produto_id, 'entrada', v_item.quantidade, 'Estorno de pedido', p_pedido_id, auth.uid());
    end loop;
  end if;

  delete from public.contas_receber where pedido_id = p_pedido_id;

  update public.pedidos
    set status = 'cancelado', atualizado_em = now()
    where id = p_pedido_id;
end;
$$;

create or replace function public.ajustar_valor_pedido(
  p_pedido_id uuid,
  p_valor_desconto numeric,
  p_valor_acrescimo numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subtotal numeric(10, 2);
  v_status public.status_pedido;
  v_numero_parcelas integer;
begin
  if coalesce(p_valor_desconto, 0) < 0 or coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Desconto e acréscimo não podem ser negativos.';
  end if;

  -- "for update" trava a linha até o fim da transação — fecha a corrida
  -- com extornar_pedido (um dos dois espera o outro terminar e vê o status
  -- já atualizado, em vez de escrever por cima às cegas).
  select subtotal, status, numero_parcelas into v_subtotal, v_status, v_numero_parcelas
    from public.pedidos where id = p_pedido_id for update;
  if v_subtotal is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Não é possível ajustar um pedido cancelado.';
  end if;
  if v_numero_parcelas > 1 then
    raise exception 'Este pedido tem parcelas geradas (cartão ou promissória) — extorne e crie um novo pedido pra mudar o valor, em vez de editar, pra não desalinhar o valor das parcelas já registradas.';
  end if;
  if v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  update public.pedidos
    set
      valor_desconto = coalesce(p_valor_desconto, 0),
      -- percentuais ficam obsoletos depois de um ajuste manual em R$ — não
      -- deixa o valor antigo (ex: "10%") mentindo sobre o novo valor.
      percentual_desconto = null,
      valor_acrescimo = coalesce(p_valor_acrescimo, 0),
      percentual_acrescimo = null,
      total = v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0),
      atualizado_em = now()
    where id = p_pedido_id;
end;
$$;

-- Ninguém sem sessão autenticada nem deveria conseguir tentar chamar essas
-- funções — remove o EXECUTE público (padrão do Postgres) e libera só pra
-- quem já passou pelo login (a checagem de papel dentro da função continua
-- sendo a defesa real, isso aqui é defesa em profundidade).
revoke all on function public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb) to authenticated;

revoke all on function public.extornar_pedido(uuid) from public;
grant execute on function public.extornar_pedido(uuid) to authenticated;

revoke all on function public.ajustar_valor_pedido(uuid, numeric, numeric) from public;
grant execute on function public.ajustar_valor_pedido(uuid, numeric, numeric) to authenticated;
