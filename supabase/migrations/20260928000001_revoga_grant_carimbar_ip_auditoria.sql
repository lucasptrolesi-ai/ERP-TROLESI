-- Achado pelo advisor de seguranca do Supabase (anon_security_definer_function_executable +
-- authenticated_security_definer_function_executable) numa varredura de rotina: carimbar_ip_auditoria()
-- -- o trigger criado/recriado na migration 20260924000003_auditoria_ip_confiavel.sql -- ficou com
-- grant de execute pra anon, authenticated e PUBLIC (o mesmo grant automatico do Supabase em toda
-- function nova, ja visto e corrigido em segredos_sistema e registrar_venda na mesma leva de
-- migrations, mas esquecido aqui porque e um trigger, nao um RPC comum).
--
-- Nao e uma vulnerabilidade explorada: o tipo de retorno e "trigger", entao o Postgres recusa
-- qualquer tentativa de chamar via /rest/v1/rpc/carimbar_ip_auditoria (so pode disparar como
-- trigger de verdade -- e disparar como trigger NAO exige grant de execute nenhum, o motor do
-- Postgres invoca direto). E limpeza de superficie de ataque, nao correcao de bug.
--
-- O QUE FAZ (uma transacao so): revoga execute de anon, authenticated e public em
-- carimbar_ip_auditoria() -- ninguem legitimo precisa chamar essa function direto, so o proprio
-- gatilho "before insert on audit_log" (que continua funcionando igual, sem grant nenhum).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve os grants,
-- -- testado pelo proprio modo 'ensaio' antes de chegar aqui):
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque so esta linha): 'ensaio' | 'aplicar' | 'desfazer'
select set_config('app.modo_migration', 'ensaio', true);
set local lock_timeout = '15s';

do $modo$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar', 'desfazer') then
    raise exception 'Modo invalido em app.modo_migration (use ensaio, aplicar ou desfazer).';
  end if;
  raise notice 'Modo: %', current_setting('app.modo_migration', true);
end $modo$;

create temp table _fp_antes on commit drop as
  select 'A ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'carimbar_ip_auditoria';

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  revoke execute on function public.carimbar_ip_auditoria() from anon, authenticated, public;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if has_function_privilege('anon', 'public.carimbar_ip_auditoria()', 'execute') then
    raise exception 'FALHA: anon ainda com execute em carimbar_ip_auditoria';
  end if;
  if has_function_privilege('authenticated', 'public.carimbar_ip_auditoria()', 'execute') then
    raise exception 'FALHA: authenticated ainda com execute em carimbar_ip_auditoria';
  end if;

  raise notice 'VERIFICACAO OK: anon e authenticated sem execute em carimbar_ip_auditoria.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  -- T1. O trigger continua disparando normal (sem grant nenhum) -- registrar_auditoria() e
  -- SECURITY DEFINER com dono postgres, entao o insert em audit_log dispara o trigger
  -- independente de qualquer grant de execute na function do trigger.
  perform public.registrar_auditoria('zz_ensaio_revoke_trigger', gen_random_uuid(), 'zz_ensaio_revoke_trigger', null, null, null);
  select count(*) into v_n from public.audit_log where acao = 'zz_ensaio_revoke_trigger';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: trigger carimbar_ip_auditoria nao disparou apos revogar os grants'; end if;

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 (trigger continua disparando sem grant de execute).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  grant execute on function public.carimbar_ip_auditoria() to anon, authenticated, public;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_dif text;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  create temp table _fp_depois on commit drop as
    select 'A ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'carimbar_ip_auditoria';

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: grants de anon/authenticated/public revogados de carimbar_ip_auditoria, trigger testado (T1) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
