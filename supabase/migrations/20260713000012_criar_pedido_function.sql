-- Fase 4: Pedidos de verdade — cria o pedido, os itens, e (se faturado)
-- baixa o estoque, tudo numa transação só. Motivo de ser uma função em vez
-- de múltiplas chamadas do client: sem isso, uma falha no meio (ex: rede
-- cai depois de criar o pedido mas antes de baixar o estoque) deixa o
-- banco inconsistente — pedido existe, mas o estoque não bateu.
--
-- SECURITY DEFINER porque a baixa de estoque precisa de UPDATE em
-- produtos, e a policy "estoque e admin gerenciam produtos" não inclui
-- vendedor — o vendedor pode vender, mas não edita produto livremente.
-- Por isso a checagem de papel é feita à mão logo no início da função,
-- espelhando a policy de pedidos ("vendedor e admin gerenciam pedidos").
create or replace function public.criar_pedido(
  p_cliente_id uuid,
  p_forma_pagamento public.forma_pagamento,
  p_status public.status_pedido,
  p_itens jsonb -- [{"produto_id": "...", "quantidade": n, "preco_unitario": n}, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_desconto numeric(10, 2) := 0;
  v_total numeric(10, 2) := 0;
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade integer;
  v_preco_unitario numeric(10, 2);
  v_estoque_atual integer;
  v_nome_produto text;
begin
  if public.meu_papel() not in ('admin', 'vendedor') then
    raise exception 'Sem permissão para criar pedidos.';
  end if;

  if p_status not in ('orcamento', 'faturado') then
    raise exception 'Status inicial inválido: use orcamento ou faturado.';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa de pelo menos um item.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_subtotal := v_subtotal
      + (v_item ->> 'quantidade')::integer * (v_item ->> 'preco_unitario')::numeric;
  end loop;

  if p_forma_pagamento = 'a_vista' then
    v_desconto := round(v_subtotal * 0.07, 2);
  end if;
  v_total := v_subtotal - v_desconto;

  insert into public.pedidos (cliente_id, vendedor_id, status, forma_pagamento, subtotal, desconto, total)
  values (p_cliente_id, auth.uid(), p_status, p_forma_pagamento, v_subtotal, v_desconto, v_total)
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_produto_id := (v_item ->> 'produto_id')::uuid;
    v_quantidade := (v_item ->> 'quantidade')::integer;
    v_preco_unitario := (v_item ->> 'preco_unitario')::numeric;

    insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
    values (v_pedido_id, v_produto_id, v_quantidade, v_preco_unitario);

    if p_status = 'faturado' then
      -- "for update" trava a linha até o fim da transação — duas vendas
      -- concorrentes do mesmo produto não conseguem vender o mesmo estoque
      -- duas vezes.
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

  return v_pedido_id;
end;
$$;
