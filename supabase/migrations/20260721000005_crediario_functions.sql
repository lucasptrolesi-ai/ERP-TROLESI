-- Fase 4 (continuação): funções de lançamento/recebimento de crediário
-- legado — faltavam desde a migration de schema original. Seguindo o
-- mesmo padrão já corrigido em abatimento/garantia: nenhuma escrita
-- sensível direto do cliente, sempre via function que checa permissão e
-- audita.
--
-- ROLLBACK:
-- drop function if exists public.receber_crediario(uuid, text);
-- drop function if exists public.lancar_crediario(uuid, uuid, numeric, date);

create or replace function public.lancar_crediario(
  p_cliente_id uuid,
  p_pedido_id uuid,
  p_valor numeric,
  p_vencimento date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crediario_legado boolean;
  v_id uuid;
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  select crediario_legado into v_crediario_legado from public.clientes where id = p_cliente_id;
  if v_crediario_legado is not true then
    raise exception 'Cliente não está autorizado pra crediário legado.';
  end if;
  if p_valor <= 0 then
    raise exception 'Valor precisa ser maior que zero.';
  end if;

  insert into public.crediario_lancamentos (cliente_id, pedido_id, valor, vencimento)
  values (p_cliente_id, p_pedido_id, p_valor, p_vencimento)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.lancar_crediario(uuid, uuid, numeric, date) from public;
grant execute on function public.lancar_crediario(uuid, uuid, numeric, date) to authenticated;

-- Recebimento em dinheiro (seção 15): exige permissão `receber_crediario`,
-- grava quem recebeu e o nº do recibo, bloqueia duplicidade (só baixa uma
-- vez — a checagem `situacao = 'em_dia'` no WHERE fecha a corrida de dois
-- cliques).
create or replace function public.receber_crediario(p_id uuid, p_recibo_numero text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linhas integer;
begin
  if not public.tem_permissao('receber_crediario') then
    raise exception 'Sem permissão para receber crediário.';
  end if;

  update public.crediario_lancamentos
    set situacao = 'pago', pago_em = now(), recebido_por = auth.uid(), recibo_numero = p_recibo_numero
    where id = p_id and situacao != 'pago';

  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception 'Lançamento não encontrado ou já pago.';
  end if;

  perform public.registrar_auditoria('crediario_lancamentos', p_id, 'receber', null, jsonb_build_object('recibo', p_recibo_numero), null);
end;
$$;

revoke all on function public.receber_crediario(uuid, text) from public;
grant execute on function public.receber_crediario(uuid, text) to authenticated;
