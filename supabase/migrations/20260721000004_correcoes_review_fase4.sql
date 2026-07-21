-- Correções de code-review sobre as Fases 1-4 (2026-07-21). Achados reais:
--
-- 1. aprovarAbatimento/reprovarAbatimento e a aprovação de garantia
--    faziam UPDATE direto na tabela, só protegido pela RLS genérica
--    admin/vendedor — nenhuma checagem da permissão granular específica
--    (`aprovar_valor_abatimento`/`aprovar_reprovar_garantia`, já criadas na
--    Fase 1) nem registro em audit_log. Qualquer vendedor podia aprovar
--    qualquer abatimento/garantia sem trilha nenhuma — contraria a seção 25
--    do documento mestre ("toda exceção... registro auditável, sem exceção
--    a essa regra").
-- 2. extornar_pedido e ajustar_valor_pedido só bloqueavam status
--    'cancelado' — um pedido já marcado 'lancado_gmax' (já digitado à mão
--    no GMax) podia ser extornado/ajustado via RPC direto, desincronizando
--    silenciosamente do GMax sem nenhum aviso.
-- 3. extornar_pedido apagava contas_receber mas nunca limpava
--    `parcelas_planejadas` — cancelar uma venda com promissória/cartão
--    parcelado deixava o parcelamento antigo "vivo" nesse campo, e a
--    reimpressão de cupom/promissórias (que cai no fallback de
--    parcelas_planejadas quando contas_receber está vazio) reimprimia notas
--    promissórias de uma venda cancelada como se estivessem válidas.
--
-- ROLLBACK:
-- (reverter extornar_pedido/ajustar_valor_pedido pras versões anteriores
-- exigiria reaplicar os corpos de 20260714000003_bloqueia_extorno_parcela_paga.sql
-- e 20260714000002_corrige_checagem_papel_null.sql, mantidos documentados lá;
-- aprovar_abatimento/reprovar_abatimento/aprovar_reprovar_garantia são
-- funções novas — `drop function` reverte sem afetar nada anterior)
-- drop function if exists public.aprovar_reprovar_garantia(uuid, boolean, text);
-- drop function if exists public.reprovar_abatimento(uuid, text);
-- drop function if exists public.aprovar_abatimento(uuid, numeric, text);

-- ===== 1. Abatimento: aprovar/reprovar exige permissão + audita =====
create or replace function public.aprovar_abatimento(
  p_id uuid,
  p_valor_final numeric default null,
  p_justificativa text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.abatimento_status;
begin
  if not public.tem_permissao('aprovar_valor_abatimento') then
    raise exception 'Sem permissão para aprovar abatimento.';
  end if;

  select status into v_status from public.abatimentos where id = p_id for update;
  if v_status is null then
    raise exception 'Abatimento não encontrado.';
  end if;
  if v_status <> 'avaliando' then
    raise exception 'Só é possível aprovar um abatimento que ainda está em avaliação.';
  end if;

  update public.abatimentos
    set status = 'aprovado',
        autorizado_por = auth.uid(),
        valor_atribuido = coalesce(p_valor_final, valor_atribuido),
        atualizado_em = now()
    where id = p_id;

  perform public.registrar_auditoria('abatimentos', p_id, 'aprovar', null, jsonb_build_object('valor_atribuido', coalesce(p_valor_final, 0)), p_justificativa);
end;
$$;

revoke all on function public.aprovar_abatimento(uuid, numeric, text) from public;
grant execute on function public.aprovar_abatimento(uuid, numeric, text) to authenticated;

create or replace function public.reprovar_abatimento(p_id uuid, p_justificativa text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.abatimento_status;
begin
  if not public.tem_permissao('aprovar_valor_abatimento') then
    raise exception 'Sem permissão para reprovar abatimento.';
  end if;

  select status into v_status from public.abatimentos where id = p_id for update;
  if v_status is null then
    raise exception 'Abatimento não encontrado.';
  end if;
  if v_status <> 'avaliando' then
    raise exception 'Só é possível reprovar um abatimento que ainda está em avaliação.';
  end if;

  update public.abatimentos
    set status = 'reprovado', autorizado_por = auth.uid(), atualizado_em = now()
    where id = p_id;

  perform public.registrar_auditoria('abatimentos', p_id, 'reprovar', null, null, p_justificativa);
end;
$$;

revoke all on function public.reprovar_abatimento(uuid, text) from public;
grant execute on function public.reprovar_abatimento(uuid, text) to authenticated;

-- ===== 2. Garantia: aprovar/reprovar (fora do fluxo automático de folheado
-- a ouro) exige permissão + audita =====
create or replace function public.aprovar_reprovar_garantia(
  p_id uuid,
  p_aprovado boolean,
  p_justificativa text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tem_permissao('aprovar_reprovar_garantia') then
    raise exception 'Sem permissão para aprovar/reprovar garantia.';
  end if;

  update public.garantias
    set aprovado = p_aprovado, aprovador_id = auth.uid(), justificativa = coalesce(p_justificativa, justificativa), atualizado_em = now()
    where id = p_id;

  if not found then
    raise exception 'Garantia não encontrada.';
  end if;

  perform public.registrar_auditoria('garantias', p_id, case when p_aprovado then 'aprovar' else 'reprovar' end, null, null, p_justificativa);
end;
$$;

revoke all on function public.aprovar_reprovar_garantia(uuid, boolean, text) from public;
grant execute on function public.aprovar_reprovar_garantia(uuid, boolean, text) to authenticated;

-- ===== 3. extornar_pedido / ajustar_valor_pedido: bloquear também
-- 'lancado_gmax', e limpar parcelas_planejadas no extorno =====
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
    -- parcelas_planejadas zerado junto — senão a impressão de cupom/
    -- promissórias (que cai nesse campo quando contas_receber está vazio)
    -- reimprime o parcelamento antigo como se a venda cancelada ainda
    -- estivesse valendo.
    set status = 'cancelado', parcelas_planejadas = null, atualizado_em = now()
    where id = p_pedido_id;
end;
$$;

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
  v_numero_parcelas integer;
begin
  if coalesce(p_valor_desconto, 0) < 0 or coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Desconto e acréscimo não podem ser negativos.';
  end if;

  select subtotal, status, numero_parcelas into v_subtotal, v_status, v_numero_parcelas
    from public.pedidos where id = p_pedido_id for update;
  if v_subtotal is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Não é possível ajustar um pedido cancelado.';
  end if;
  if v_status = 'lancado_gmax' then
    raise exception 'Este pedido já foi lançado no GMax — não pode ser ajustado por aqui.';
  end if;
  if v_numero_parcelas > 1 then
    raise exception 'Este pedido tem parcelas geradas (cartão ou promissória) — extorne e crie um novo pedido pra mudar o valor, em vez de editar, pra não desalinhar o valor das parcelas já registradas.';
  end if;
  if v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  update public.pedidos
    set
      valor_desconto = coalesce(p_valor_desconto, 0),
      percentual_desconto = null,
      valor_acrescimo = coalesce(p_valor_acrescimo, 0),
      percentual_acrescimo = null,
      total = v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0),
      atualizado_em = now()
    where id = p_pedido_id;
end;
$$;
