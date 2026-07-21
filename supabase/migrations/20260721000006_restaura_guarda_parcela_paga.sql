-- CORREÇÃO CRÍTICA (achado real do code-review, ângulo removed-behavior):
-- a migration 20260721000004_correcoes_review_fase4.sql reescreveu
-- extornar_pedido pra adicionar o bloqueio de 'lancado_gmax', mas ao
-- copiar o corpo da function esqueceu de trazer junto o bloqueio de
-- "parcela já paga" que a migration 20260714000003 tinha adicionado —
-- extornar um pedido faturado com alguma parcela já baixada no Financeiro
-- voltou a apagar esse histórico de pagamento silenciosamente, sem aviso
-- nenhum. Restaura a checagem, mantendo o bloqueio de lancado_gmax que
-- foi adicionado corretamente.
--
-- ROLLBACK:
-- (reverter puramente esta correção reintroduziria o bug de perda de
-- dado — não há rollback seguro pra esta migration especificamente;
-- reverter pra antes dela significa voltar pro estado COM o bug.)

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
  if v_status = 'lancado_gmax' then
    raise exception 'Este pedido já foi lançado no GMax — não pode ser extornado por aqui (ajuste direto no GMax se necessário).';
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
    set status = 'cancelado', parcelas_planejadas = null, atualizado_em = now()
    where id = p_pedido_id;
end;
$$;
