-- Fase 4: extornar pedido — cancela e reverte os efeitos de um pedido
-- faturado (devolve o estoque, remove as parcelas a receber), numa
-- transação só, pelo mesmo motivo de criar_pedido: reversão parcial
-- (ex: estoque volta mas parcela não é removida) deixaria o banco
-- inconsistente.
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
  if public.meu_papel() not in ('admin', 'vendedor') then
    raise exception 'Sem permissão para extornar pedidos.';
  end if;

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

-- Ajuste manual de desconto/acréscimo depois de criado (RLS de "pedidos"
-- já libera update pra admin/vendedor — isso só recalcula o total junto).
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
begin
  select subtotal, status into v_subtotal, v_status from public.pedidos where id = p_pedido_id;
  if v_subtotal is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Não é possível ajustar um pedido cancelado.';
  end if;
  if v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  update public.pedidos
    set
      valor_desconto = coalesce(p_valor_desconto, 0),
      valor_acrescimo = coalesce(p_valor_acrescimo, 0),
      total = v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0),
      atualizado_em = now()
    where id = p_pedido_id;
end;
$$;
