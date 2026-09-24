-- Central do Admin: functions pra listar e resolver decisoes pendentes (tabela pending_decisions ja
-- existe desde a fase 1 do documento mestre, mas nunca teve tela nenhuma -- so dava pra ver por SQL).
-- Pre-requisito: nenhum especifico do varejo, so o schema base (assert_papel, registrar_auditoria).
--
-- O QUE FAZ (uma transacao so):
--   1. listar_decisoes_pendentes(): admin-only, devolve as pendencias com ativo=true (ambiguidades de
--      regra de negocio aguardando decisao humana, regra 9 do CLAUDE.md).
--   2. resolver_decisao_pendente(p_chave, p_decisao): admin-only, grava a decisao tomada (texto livre),
--      marca ativo=false, registra quem e quando, audita.
--
-- COMO RODAR: igual as migrations anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo tem o DROP exato
-- -- pra cada CREATE, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' ||
         coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.resolver_decisao_pendente(text, text)') is not null then
    raise exception 'ABORTADO: parece ja aplicada (resolver_decisao_pendente existe).';
  end if;

  create or replace function public.listar_decisoes_pendentes()
  returns table(id uuid, chave text, descricao text, criado_em timestamptz)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    return query
      select pd.id, pd.chave, pd.descricao, pd.criado_em
        from public.pending_decisions pd
       where pd.ativo
       order by pd.criado_em asc;
  end
  $fn$;
  revoke execute on function public.listar_decisoes_pendentes() from public, anon, authenticated;
  grant execute on function public.listar_decisoes_pendentes() to authenticated;

  create or replace function public.resolver_decisao_pendente(p_chave text, p_decisao text) returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_id uuid;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    if p_decisao is null or length(trim(p_decisao)) = 0 then
      raise exception 'Informe a decisao tomada';
    end if;
    update public.pending_decisions
       set ativo = false, decisao = trim(p_decisao), decidido_em = now(), decidido_por = auth.uid()
     where chave = p_chave and ativo
     returning id into v_id;
    if v_id is null then
      raise exception 'Decisao nao encontrada ou ja resolvida';
    end if;
    perform public.registrar_auditoria('pending_decisions', v_id, 'decisao_resolvida', null,
      jsonb_build_object('chave', p_chave, 'decisao', p_decisao), null);
  end
  $fn$;
  revoke execute on function public.resolver_decisao_pendente(text, text) from public, anon, authenticated;
  grant execute on function public.resolver_decisao_pendente(text, text) to authenticated;
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

  select count(*) into v_n from information_schema.routines
   where routine_schema = 'public' and routine_name in ('listar_decisoes_pendentes', 'resolver_decisao_pendente');
  if v_n <> 2 then raise exception 'FALHA: funcoes novas = %, esperado 2', v_n; end if;

  raise notice 'VERIFICACAO OK: listar_decisoes_pendentes e resolver_decisao_pendente criadas.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_chave text := 'zz_ensaio_decisao_' || substr(gen_random_uuid()::text, 1, 8);
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  insert into public.pending_decisions (chave, descricao, ativo) values (v_chave, 'ENSAIO: decisao de teste', true);

  -- T1. Vendedora nao acessa nenhuma das duas functions
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.listar_decisoes_pendentes();
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: vendedora acessou listar_decisoes_pendentes'; end if;
  v_ok := false;
  begin
    perform public.resolver_decisao_pendente(v_chave, 'tentativa indevida');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: vendedora acessou resolver_decisao_pendente'; end if;
  execute 'reset role';

  -- T2. Admin ve a pendencia sintetica na lista
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.listar_decisoes_pendentes() where chave = v_chave;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: pendencia sintetica nao apareceu na listagem'; end if;

  -- T3. Resolver exige texto nao vazio
  v_ok := false;
  begin
    perform public.resolver_decisao_pendente(v_chave, '   ');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T3]: resolveu com decisao vazia'; end if;

  -- T4. Resolver de verdade: grava decisao, sai da listagem, audita
  perform public.resolver_decisao_pendente(v_chave, 'ENSAIO: decisao registrada no teste');
  select count(*) into v_n from public.listar_decisoes_pendentes() where chave = v_chave;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T4]: pendencia resolvida ainda aparece na listagem'; end if;
  select count(*) into v_n from public.pending_decisions
   where chave = v_chave and not ativo and decisao = 'ENSAIO: decisao registrada no teste'
     and decidido_por = v_lucas and decidido_em is not null;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: decisao nao foi gravada corretamente'; end if;
  select count(*) into v_n from public.audit_log where acao = 'decisao_resolvida' and usuario_id = v_lucas
   and (valor_novo ->> 'chave') = v_chave;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: resolucao nao foi auditada'; end if;

  -- T5. Resolver duas vezes nao pode
  v_ok := false;
  begin
    perform public.resolver_decisao_pendente(v_chave, 'segunda tentativa');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: resolveu a mesma decisao duas vezes'; end if;
  execute 'reset role';

  delete from public.pending_decisions where chave = v_chave;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T5 (admin-only, listagem, validacao, resolucao, auditoria, idempotencia).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.resolver_decisao_pendente(text, text);
  drop function if exists public.listar_decisoes_pendentes();
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
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' ||
           coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace;

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: listar_decisoes_pendentes e resolver_decisao_pendente aplicadas, verificadas, testadas (T1 a T5) e desfeitas identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
