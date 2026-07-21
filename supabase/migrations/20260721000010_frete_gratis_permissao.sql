-- Achado do code-review (2 ângulos independentes confirmaram): frete
-- grátis não checava a permissão `conceder_frete_gratis` (criada na Fase 1
-- especificamente pra isso) nem gravava auditoria — qualquer vendedor/
-- estoque podia zerar o custo de qualquer frete sem controle nenhum.
--
-- ROLLBACK:
-- drop function if exists public.criar_expedicao(uuid, text, text, text, text, numeric, integer, boolean, text);

create or replace function public.criar_expedicao(
  p_pedido_id uuid,
  p_endereco_entrega text default null,
  p_destinatario text default null,
  p_transportadora text default null,
  p_modalidade text default null,
  p_custo numeric default 0,
  p_frete_gratis boolean default false,
  p_motivo_frete_gratis text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.assert_papel(array['admin', 'vendedor', 'estoque']::public.papel_usuario[]);

  if p_frete_gratis then
    if not public.tem_permissao('conceder_frete_gratis') then
      raise exception 'Sem permissão para conceder frete grátis.';
    end if;
    if p_motivo_frete_gratis is null or length(trim(p_motivo_frete_gratis)) = 0 then
      raise exception 'Motivo do frete grátis é obrigatório.';
    end if;
  end if;

  insert into public.expedicoes (
    pedido_id, endereco_entrega, destinatario, transportadora, modalidade,
    custo, frete_gratis, motivo_frete_gratis
  )
  values (
    p_pedido_id, p_endereco_entrega, p_destinatario, p_transportadora, p_modalidade,
    case when p_frete_gratis then 0 else coalesce(p_custo, 0) end,
    p_frete_gratis, case when p_frete_gratis then p_motivo_frete_gratis else null end
  )
  returning id into v_id;

  if p_frete_gratis then
    perform public.registrar_auditoria('expedicoes', v_id, 'conceder_frete_gratis', null, null, p_motivo_frete_gratis);
  end if;

  return v_id;
end;
$$;

revoke all on function public.criar_expedicao(uuid, text, text, text, text, numeric, boolean, text) from public;
grant execute on function public.criar_expedicao(uuid, text, text, text, text, numeric, boolean, text) to authenticated;
