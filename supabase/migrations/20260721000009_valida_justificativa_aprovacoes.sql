-- Achado do code-review: aprovar_abatimento/reprovar_abatimento/
-- aprovar_reprovar_garantia aceitavam justificativa vazia (string '', não
-- null — o `?? null` do lado TypeScript só pega null/undefined, não string
-- vazia) e registravam a auditoria mesmo assim, ao contrário de
-- converter_cliente_em_crediario (mesma migration original) que já validava
-- isso. Uniformiza: as 3 passam a exigir justificativa não-vazia, igual o
-- crediário.
--
-- ROLLBACK:
-- (reverter tornaria a validação de justificativa inconsistente de novo
-- entre as functions de aprovação — não recomendado; se necessário, o
-- corpo anterior está em 20260721000004_correcoes_review_fase4.sql.)

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
  if p_justificativa is null or length(trim(p_justificativa)) = 0 then
    raise exception 'Justificativa é obrigatória pra aprovar abatimento.';
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
  if p_justificativa is null or length(trim(p_justificativa)) = 0 then
    raise exception 'Justificativa é obrigatória pra reprovar abatimento.';
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
  if p_justificativa is null or length(trim(p_justificativa)) = 0 then
    raise exception 'Justificativa é obrigatória pra aprovar/reprovar garantia.';
  end if;

  update public.garantias
    set aprovado = p_aprovado, aprovador_id = auth.uid(), justificativa = p_justificativa, atualizado_em = now()
    where id = p_id;

  if not found then
    raise exception 'Garantia não encontrada.';
  end if;

  perform public.registrar_auditoria('garantias', p_id, case when p_aprovado then 'aprovar' else 'reprovar' end, null, null, p_justificativa);
end;
$$;
