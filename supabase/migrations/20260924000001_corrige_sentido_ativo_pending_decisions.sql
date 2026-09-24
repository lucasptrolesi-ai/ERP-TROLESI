-- Corrige a Central do Admin: o sentido de pending_decisions.ativo estava invertido.
-- Pre-requisito: etapa 20260923000003 aplicada (listar_decisoes_pendentes, resolver_decisao_pendente).
--
-- O ERRO: o CLAUDE.md e o uso real do banco (confirmado nos dados: as 10 ambiguidades do documento
-- mestre + a de operacao_id, todas com decisao preenchida e decidido_em datado, estao com ativo=true;
-- as 27 pendencias de verdade, criadas durante o varejo, estao com ativo=false e decisao nula) dizem
-- que ativo=false = AINDA PENDENTE, ativo=true = JA DECIDIDO. As duas functions da migration anterior
-- foram escritas com o sentido trocado: listar_decisoes_pendentes mostrava as 11 ja decididas (como
-- se fossem pendencia) e escondia as 27 pendencias reais; resolver_decisao_pendente procurava
-- "where ativo" (nunca acharia uma pendencia de verdade, que e ativo=false) e gravava ativo=false ao
-- resolver (o oposto do padrao ja usado nas 11 decisoes historicas).
--
-- O QUE FAZ (uma transacao so): corrige as duas functions pro sentido certo. Nao muda nenhum dado
-- existente -- so a logica de leitura/escrita.
--
-- COMO RODAR: igual as migrations anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve a versao
-- -- anterior das duas functions, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('listar_decisoes_pendentes', 'resolver_decisao_pendente');

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  create or replace function public.listar_decisoes_pendentes()
  returns table(id uuid, chave text, descricao text, criado_em timestamptz)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    return query
      select pd.id, pd.chave, pd.descricao, pd.criado_em
        from public.pending_decisions pd
       where not pd.ativo
       order by pd.criado_em asc;
  end
  $fn$;

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
       set ativo = true, decisao = trim(p_decisao), decidido_em = now(), decidido_por = auth.uid()
     where chave = p_chave and not ativo
     returning id into v_id;
    if v_id is null then
      raise exception 'Decisao nao encontrada ou ja resolvida';
    end if;
    perform public.registrar_auditoria('pending_decisions', v_id, 'decisao_resolvida', null,
      jsonb_build_object('chave', p_chave, 'decisao', p_decisao), null);
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

  select count(*) into v_n from information_schema.routines
   where routine_schema = 'public' and routine_name in ('listar_decisoes_pendentes', 'resolver_decisao_pendente');
  if v_n <> 2 then raise exception 'FALHA: funcoes = %, esperado 2', v_n; end if;

  raise notice 'VERIFICACAO OK: funcoes recriadas com o sentido corrigido.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_chave text := 'zz_ensaio_ativo_' || substr(gen_random_uuid()::text, 1, 8);
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  -- T1. Com dado real: pendencias de verdade (ativo=false) aparecem; as ja decididas (ativo=true) nao
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.listar_decisoes_pendentes();
  if v_n < 20 then raise exception 'TESTE FALHOU [T1]: listagem devolveu so % pendencias, esperado pelo menos 20 (as com ativo=false)', v_n; end if;
  select count(*) into v_n from public.listar_decisoes_pendentes() where chave = 'codigo_ventilador_finalidade';
  if v_n <> 0 then raise exception 'TESTE FALHOU [T1]: uma decisao ja tomada (codigo_ventilador_finalidade) ainda aparece como pendente'; end if;
  select count(*) into v_n from public.listar_decisoes_pendentes() where chave = 'pin_supervisor_politica';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: pendencia real (pin_supervisor_politica) nao apareceu'; end if;

  -- T2. Resolver uma pendencia sintetica de verdade agora funciona (antes, "where ativo" nunca achava)
  insert into public.pending_decisions (chave, descricao, ativo) values (v_chave, 'ENSAIO: pendencia de teste', false);
  perform public.resolver_decisao_pendente(v_chave, 'ENSAIO: decisao tomada no teste');
  select count(*) into v_n from public.pending_decisions where chave = v_chave and ativo and decisao is not null;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: resolver nao gravou ativo=true e decisao'; end if;
  select count(*) into v_n from public.listar_decisoes_pendentes() where chave = v_chave;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T2]: pendencia resolvida ainda aparece na listagem'; end if;

  -- T3. Resolver duas vezes nao pode (ja esta ativo=true)
  v_ok := false;
  begin
    perform public.resolver_decisao_pendente(v_chave, 'segunda tentativa');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T3]: resolveu a mesma pendencia duas vezes'; end if;
  execute 'reset role';

  delete from public.pending_decisions where chave = v_chave;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T3 (listagem no sentido certo com dado real, resolucao funciona, idempotencia).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
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
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('listar_decisoes_pendentes', 'resolver_decisao_pendente');

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu as functions ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: sentido de ativo corrigido nas duas functions, verificado, testado (T1 a T3) com dado real e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
