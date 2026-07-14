-- Fase 4: criar_pedido v2 — desconto/acréscimo manuais e geração de
-- parcelas (contas_receber) pra cartão parcelado (4-12x) e promissória.
-- Mesmo motivo de ser uma função só (não múltiplas chamadas do client):
-- pedido + itens + baixa de estoque + parcelas viram uma transação atômica
-- só, não fica nada pela metade se algo falhar no meio do caminho.
create or replace function public.criar_pedido(
  p_cliente_id uuid,
  p_forma_pagamento public.forma_pagamento,
  p_status public.status_pedido,
  p_itens jsonb, -- [{"produto_id", "quantidade", "preco_unitario"}, ...]
  p_valor_desconto numeric default 0,
  p_percentual_desconto numeric default null,
  p_valor_acrescimo numeric default 0,
  p_percentual_acrescimo numeric default null,
  p_parcelas jsonb default null -- [{"valor", "vencimento"}, ...] — null/vazio = pagamento à vista, sem parcela a receber
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
  v_numero_parcelas integer := coalesce(jsonb_array_length(p_parcelas), 0);
  v_indice integer := 0;
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

  v_total := v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0);
  if v_total < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
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

  if v_numero_parcelas > 0 then
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
