-- Resolve a pendencia "auditoria_ip_confiavel": audit_log.ip_cliente vinha de um cabecalho HTTP
-- (x-client-ip) que QUALQUER chamador com um JWT valido podia forjar direto contra a API do Supabase,
-- pulando o Next.js -- a trilha de auditoria podia mentir sobre o IP do usuario final.
-- Pre-requisito: etapa 20260921000004 (carimbar_ip_auditoria, audit_log.ip/ip_cliente ja existem).
--
-- O QUE FAZ (uma transacao so):
--   1. Cria public.segredos_sistema (RLS ligada, ZERO grant -- mesmo padrao de public.supervisores:
--      so uma function SECURITY DEFINER consegue ler). Guarda só o HASH sha256 de um segredo
--      compartilhado, nunca o segredo em si.
--   2. Reescreve carimbar_ip_auditoria() como SECURITY DEFINER: so aceita o x-client-ip (IP real do
--      navegador, que o Next.js já lê do x-forwarded-for da Vercel) se vier acompanhado de
--      x-client-ip-secret batendo com o hash guardado. Sem o segredo certo, ip_cliente fica null em
--      vez de gravar um valor não verificado. audit_log.ip (de x-forwarded-for direto, quem o
--      Supabase viu conectar) não muda -- a pendência era só sobre ip_cliente.
--
-- Depois de aplicar esta migration, falta 1 passo manual (NAO entra em nenhum arquivo, o segredo
-- nunca pode ir pro git): rodar em separado o SQL que grava o hash do segredo real, e configurar
-- AUDIT_IP_SHARED_SECRET no .env.local e na Vercel. Passo a passo enviado à parte no chat.
--
-- COMO RODAR: igual as migrations anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve a function e
-- -- remove a tabela nova, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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
  select item from (
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'carimbar_ip_auditoria'
    union all
    select 'T ' || c.relname
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'segredos_sistema'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  create table if not exists public.segredos_sistema (
    chave text primary key,
    valor_hash text not null,
    atualizado_em timestamptz not null default now()
  );
  alter table public.segredos_sistema enable row level security;
  -- O Supabase tem "default privileges" que dao grant automatico em toda tabela nova pra anon/
  -- authenticated (revogado explicitamente abaixo) -- mesmo padrao de public.supervisores. Sem
  -- policy tambem: nenhum papel le esta tabela direto, so funcoes SECURITY DEFINER.
  revoke all on public.segredos_sistema from anon, authenticated;

  create or replace function public.carimbar_ip_auditoria() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_h jsonb;
    v_hash_esperado text;
    v_secret text;
  begin
    begin
      v_h := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      v_h := null;
    end;
    if v_h is not null then
      begin
        new.ip := nullif(trim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), '')::inet;
      exception when others then
        new.ip := null;
      end;

      select s.valor_hash into v_hash_esperado from public.segredos_sistema s where s.chave = 'ip_cliente_secret_hash';
      v_secret := v_h ->> 'x-client-ip-secret';
      if v_hash_esperado is not null and v_secret is not null
         and encode(extensions.digest(convert_to(v_secret, 'utf8'), 'sha256'), 'hex') = v_hash_esperado then
        new.ip_cliente := nullif(left(v_h ->> 'x-client-ip', 64), '');
      else
        new.ip_cliente := null;
      end if;
    end if;
    return new;
  end
  $fn$;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select count(*) into v_n from pg_class where relnamespace = 'public'::regnamespace and relname = 'segredos_sistema';
  if v_n <> 1 then raise exception 'FALHA: tabela segredos_sistema nao existe'; end if;

  select count(*) into v_n from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'segredos_sistema' and grantee in ('authenticated', 'anon', 'public');
  if v_n <> 0 then raise exception 'FALHA: segredos_sistema tem grant pra authenticated/anon/public (esperado zero)'; end if;

  select count(*) into v_n from information_schema.routines
   where routine_schema = 'public' and routine_name = 'carimbar_ip_auditoria';
  if v_n <> 1 then raise exception 'FALHA: carimbar_ip_auditoria nao existe'; end if;

  raise notice 'VERIFICACAO OK: segredos_sistema criada e trancada, carimbar_ip_auditoria recriada.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_segredo text := 'ENSAIO_' || substr(gen_random_uuid()::text, 1, 12);
  v_hash text := encode(extensions.digest(convert_to(v_segredo, 'utf8'), 'sha256'), 'hex');
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  insert into public.segredos_sistema (chave, valor_hash) values ('ip_cliente_secret_hash', v_hash);

  -- T1. Segredo certo no cabecalho -> ip_cliente confiavel gravado, ip (x-forwarded-for) tambem
  perform set_config('request.headers', jsonb_build_object(
    'x-forwarded-for', '203.0.113.9, 10.0.0.1',
    'x-client-ip', '198.51.100.7',
    'x-client-ip-secret', v_segredo
  )::text, true);
  perform public.registrar_auditoria('zz_ensaio_ip', gen_random_uuid(), 'zz_ensaio_ip_ok', null, null, null);
  select count(*) into v_n from public.audit_log
   where acao = 'zz_ensaio_ip_ok' and ip = '203.0.113.9'::inet and ip_cliente = '198.51.100.7';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: com segredo certo, ip/ip_cliente nao foram gravados'; end if;

  -- T2. Segredo errado -> ip_cliente fica null, mas ip (x-forwarded-for) continua sendo gravado normal
  perform set_config('request.headers', jsonb_build_object(
    'x-forwarded-for', '203.0.113.9, 10.0.0.1',
    'x-client-ip', '198.51.100.7',
    'x-client-ip-secret', 'segredo_errado'
  )::text, true);
  perform public.registrar_auditoria('zz_ensaio_ip', gen_random_uuid(), 'zz_ensaio_ip_secret_errado', null, null, null);
  select count(*) into v_n from public.audit_log
   where acao = 'zz_ensaio_ip_secret_errado' and ip = '203.0.113.9'::inet and ip_cliente is null;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: com segredo errado, ip_cliente deveria ficar null (nao ficou) ou ip parou de ser gravado'; end if;

  -- T3. Sem x-client-ip-secret nenhum (cabecalho antigo, chamada direta forjando so x-client-ip) -> ip_cliente null
  perform set_config('request.headers', jsonb_build_object(
    'x-forwarded-for', '203.0.113.9',
    'x-client-ip', '198.51.100.7'
  )::text, true);
  perform public.registrar_auditoria('zz_ensaio_ip', gen_random_uuid(), 'zz_ensaio_ip_sem_secret', null, null, null);
  select count(*) into v_n from public.audit_log where acao = 'zz_ensaio_ip_sem_secret' and ip_cliente is null;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: sem x-client-ip-secret, ip_cliente deveria ficar null'; end if;

  perform set_config('request.headers', '', true);

  -- T4. segredos_sistema e mesmo intransponivel por authenticated (mesmo padrao de supervisores)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform count(*) from public.segredos_sistema;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  execute 'reset role';
  if not v_ok then raise exception 'TESTE FALHOU [T4]: authenticated conseguiu ler segredos_sistema direto'; end if;

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T4 (segredo certo confia, segredo errado/ausente descarta ip_cliente sem quebrar ip, tabela trancada).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop table if exists public.segredos_sistema;

  create or replace function public.carimbar_ip_auditoria() returns trigger
  language plpgsql as $fn$
  declare
    v_h jsonb;
  begin
    begin
      v_h := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      v_h := null;
    end;
    if v_h is not null then
      begin
        new.ip := nullif(trim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), '')::inet;
      exception when others then
        new.ip := null;
      end;
      new.ip_cliente := nullif(left(v_h ->> 'x-client-ip', 64), '');
    end if;
    return new;
  end
  $fn$;
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
    select item from (
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as item
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'carimbar_ip_auditoria'
      union all
      select 'T ' || c.relname
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'segredos_sistema'
    ) x;

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: segredos_sistema criada e trancada, carimbar_ip_auditoria exige segredo pra confiar em ip_cliente, testado (T1 a T4) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
