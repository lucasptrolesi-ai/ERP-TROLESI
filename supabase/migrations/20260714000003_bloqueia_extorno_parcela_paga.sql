-- Achado no code-review do módulo Financeiro: agora que existe uma tela de
-- "marcar como pago" pra contas_receber, extornar_pedido apagava esse
-- histórico de pagamento já recebido junto com as parcelas ainda em
-- aberto (o delete era incondicional). Bloqueia o extorno enquanto houver
-- parcela paga, seguindo o mesmo padrão já usado em ajustar_valor_pedido
-- pra pedidos com parcelas geradas.

create or replace function public.extornar_pedido(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.status_pedido;
  v_item record;
  v_parcelas_pagas integer;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  select status into v_status from public.pedidos where id = p_pedido_id for update;
  if v_status is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Este pedido já está cancelado.';
  end if;

  select count(*) into v_parcelas_pagas
    from public.contas_receber where pedido_id = p_pedido_id and situacao = 'pago';
  if v_parcelas_pagas > 0 then
    raise exception 'Este pedido tem % parcela(s) já marcada(s) como paga(s) no Financeiro — extornar apagaria esse histórico de pagamento. Desfaça a baixa da(s) parcela(s) no Financeiro antes de extornar, se for isso mesmo que você quer.',
      v_parcelas_pagas;
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

revoke all on function public.extornar_pedido(uuid) from public;
grant execute on function public.extornar_pedido(uuid) to authenticated;
