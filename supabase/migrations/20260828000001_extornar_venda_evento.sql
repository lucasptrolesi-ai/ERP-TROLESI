-- Extorno de venda do PDV Eventos (pedido direto do usuário, 2026-08-28) —
-- mesmo espírito do extornar_pedido do PDV real (migration 20260714000001),
-- bem mais simples aqui porque PDV Eventos não tem parcela/comissão/conta a
-- receber: só devolve a quantidade de cada item pro estoque do evento e
-- marca a venda como 'cancelado' (coluna que já existia desde
-- 20260813000001, só nunca tinha sido usada).
--
-- ROLLBACK:
-- revoke execute on function public.extornar_venda_evento(uuid) from authenticated;
-- drop function if exists public.extornar_venda_evento(uuid);

create or replace function public.extornar_venda_evento(p_venda_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_item record;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  select status into v_status from public.vendas_evento where id = p_venda_id for update;
  if v_status is null then
    raise exception 'Venda não encontrada.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Essa venda já foi extornada.';
  end if;

  -- produto_evento_id pode ser null (peça excluída depois da venda, "on
  -- delete set null" — migration 20260813000001) — nesse caso não tem pra
  -- onde devolver a quantidade, só segue extornando o resto normalmente.
  for v_item in
    select produto_evento_id, quantidade from public.vendas_evento_itens where venda_id = p_venda_id
  loop
    if v_item.produto_evento_id is not null then
      update public.produtos_evento set quantidade_estoque = quantidade_estoque + v_item.quantidade
        where id = v_item.produto_evento_id;
    end if;
  end loop;

  update public.vendas_evento set status = 'cancelado' where id = p_venda_id;
end;
$$;

revoke all on function public.extornar_venda_evento(uuid) from public;
grant execute on function public.extornar_venda_evento(uuid) to authenticated;
