-- Fase 5: frete grátis automático (seção 22, decisão registrada em
-- pending_decisions pra 'frete_gratis_base_calculo') — até aqui só existia
-- o caminho manual (permissão + motivo obrigatório + auditoria). Agora,
-- quando ninguém pediu frete grátis manualmente, o sistema confere o total
-- do pedido (pedidos.total, já com desconto automático aplicado — base
-- decidida) e libera sozinho a partir de R$700, sem exigir permissão nem
-- auditoria: é a regra normal se aplicando, não uma exceção discricionária.
-- Pedido explícito de frete grátis (ex: abaixo de R$700, por liberalidade)
-- continua exigindo a permissão + motivo + auditoria de sempre.
--
-- ROLLBACK: reverter pro corpo de 20260721000010_frete_gratis_permissao.sql

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
  v_total_pedido numeric(10, 2);
  v_frete_gratis boolean := p_frete_gratis;
  v_motivo text := p_motivo_frete_gratis;
  v_automatico boolean := false;
begin
  perform public.assert_papel(array['admin', 'vendedor', 'estoque']::public.papel_usuario[]);

  if p_frete_gratis then
    if not public.tem_permissao('conceder_frete_gratis') then
      raise exception 'Sem permissão para conceder frete grátis.';
    end if;
    if p_motivo_frete_gratis is null or length(trim(p_motivo_frete_gratis)) = 0 then
      raise exception 'Motivo do frete grátis é obrigatório.';
    end if;
  else
    select total into v_total_pedido from public.pedidos where id = p_pedido_id;
    if v_total_pedido >= 700 then
      v_frete_gratis := true;
      v_motivo := 'Frete grátis automático (venda ≥ R$700)';
      v_automatico := true;
    end if;
  end if;

  insert into public.expedicoes (
    pedido_id, endereco_entrega, destinatario, transportadora, modalidade,
    custo, frete_gratis, motivo_frete_gratis
  )
  values (
    p_pedido_id, p_endereco_entrega, p_destinatario, p_transportadora, p_modalidade,
    case when v_frete_gratis then 0 else coalesce(p_custo, 0) end,
    v_frete_gratis, case when v_frete_gratis then v_motivo else null end
  )
  returning id into v_id;

  -- Auditoria só na concessão manual/discricionária — a automática é a
  -- regra normal se aplicando, não uma exceção (seção 25 exige auditoria
  -- pra exceção, não pra toda aplicação determinística de regra).
  if v_frete_gratis and not v_automatico then
    perform public.registrar_auditoria('expedicoes', v_id, 'conceder_frete_gratis', null, null, v_motivo);
  end if;

  return v_id;
end;
$$;

-- Grants já existentes (mesma assinatura) continuam valendo.
