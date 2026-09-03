-- Venda de peça não cadastrada no PDV Eventos (pedido do usuário,
-- 2026-09-03): "brinco de aço", digita código × multiplicador, sistema
-- calcula o preço (mesma fórmula já usada no Pedidos real —
-- calcularPrecoUnitario, precificacao.ts) — sem precisar cadastrar a peça
-- em produtos_evento antes de vender.
--
-- vendas_evento_itens.produto_evento_id já era nullable desde a criação
-- (20260813000001, "on delete set null"), mas criar_venda_evento nunca
-- tratava esse caso: sempre fazia `select ... where id = v_produto_id` e
-- explodia com "Produto do evento não encontrado" se o id viesse null.
-- Corrige só isso, em cima da versão de 8 parâmetros (20260820000001, com
-- dados do cliente) — item sem produto_evento_id agora pula a baixa de
-- estoque (não tem o que baixar) e grava normalmente com
-- produto_evento_id null. Assinatura não muda, então create or replace
-- substitui a mesma função (sem overload duplicado).
--
-- ROLLBACK:
-- (reverte pro comportamento anterior — reaplica a versão de 20260820000001 da function, ver esse arquivo pelo corpo original)

create or replace function public.criar_venda_evento(
  p_itens jsonb, -- [{produto_evento_id, quantidade, preco_unitario, nome}] — produto_evento_id pode ser null (peça avulsa)
  p_forma_pagamento text,
  p_valor_desconto numeric default 0,
  p_numero_parcelas integer default 1,
  p_idempotency_key uuid default null,
  p_cliente_nome text default null,
  p_cliente_cpf text default null,
  p_cliente_telefone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade integer;
  v_preco numeric(10, 2);
  v_estoque_atual integer;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_idempotency_key is not null then
    select id into v_venda_id from public.vendas_evento where idempotency_key = p_idempotency_key;
    if v_venda_id is not null then
      return v_venda_id;
    end if;
  end if;

  if p_forma_pagamento not in ('dinheiro', 'pix', 'cartao_vista', 'cartao_parcelado') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'A venda precisa de pelo menos um item.';
  end if;

  if coalesce(p_valor_desconto, 0) < 0 then
    raise exception 'Desconto não pode ser negativo.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_preco := (v_item ->> 'preco_unitario')::numeric;
    if v_preco < 0 then
      raise exception 'Preço unitário não pode ser negativo.';
    end if;
    if (v_item ->> 'quantidade')::integer <= 0 then
      raise exception 'Quantidade precisa ser maior que zero.';
    end if;
    v_subtotal := v_subtotal + (v_item ->> 'quantidade')::integer * v_preco;
  end loop;

  v_total := v_subtotal - coalesce(p_valor_desconto, 0);
  if v_total < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  begin
    insert into public.vendas_evento (
      forma_pagamento, numero_parcelas, subtotal, valor_desconto, total, idempotency_key, criado_por,
      cliente_nome, cliente_cpf, cliente_telefone
    )
    values (
      p_forma_pagamento, greatest(1, p_numero_parcelas), v_subtotal, coalesce(p_valor_desconto, 0), v_total,
      p_idempotency_key, auth.uid(),
      nullif(btrim(p_cliente_nome), ''), nullif(btrim(p_cliente_cpf), ''), nullif(btrim(p_cliente_telefone), '')
    )
    returning id into v_venda_id;
  exception
    when unique_violation then
      select id into v_venda_id from public.vendas_evento where idempotency_key = p_idempotency_key;
      return v_venda_id;
  end;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_produto_id := (v_item ->> 'produto_evento_id')::uuid;
    v_quantidade := (v_item ->> 'quantidade')::integer;
    v_preco := (v_item ->> 'preco_unitario')::numeric;

    -- Peça avulsa (não cadastrada, produto_evento_id null): nada a baixar
    -- de estoque, só grava o item na venda.
    if v_produto_id is not null then
      select quantidade_estoque into v_estoque_atual from public.produtos_evento where id = v_produto_id for update;
      if v_estoque_atual is null then
        raise exception 'Produto do evento não encontrado.';
      end if;
      update public.produtos_evento set quantidade_estoque = quantidade_estoque - v_quantidade
        where id = v_produto_id;
    end if;

    insert into public.vendas_evento_itens (venda_id, produto_evento_id, nome, quantidade, preco_unitario)
    values (v_venda_id, v_produto_id, coalesce(v_item ->> 'nome', ''), v_quantidade, v_preco);
  end loop;

  return v_venda_id;
end;
$$;

revoke all on function public.criar_venda_evento(
  jsonb, text, numeric, integer, uuid, text, text, text
) from public;
grant execute on function public.criar_venda_evento(
  jsonb, text, numeric, integer, uuid, text, text, text
) to authenticated;
