-- Etapa 5c do modulo de varejo: corrige um gap de RLS achado ao montar as telas, e cria funcoes de
-- apoio que as telas do varejo precisam.
-- Pre-requisito: etapas 1 a 4 aplicadas (nao depende de 5a/5b).
--
-- ACHADO (achado durante a etapa 5, corrigido antes de virar tela): a etapa 1 criou "depositos" e
-- "caixas" com RLS proprio ("admin gerencia" + "usuario le das suas operacoes"), mas, diferente das
-- 31 tabelas da etapa 2, elas NUNCA receberam a politica restritiva "escopo de operacao". Resultado:
-- um usuario ligado a mais de uma operacao (ex.: o admin) lia depositos/caixas de QUALQUER operacao
-- sua, mesmo fora do contexto atual da sessao -- nomes de deposito/caixa, nao dado financeiro, mas
-- contraria a regra de isolamento total. Corrige com a MESMA politica restritiva das outras tabelas.
--
-- ACHADO 2 (code review, 2026-09-22, antes de aplicar): a mesma falha existia em "empresas" (CNPJ,
-- inscricao estadual, endereco -- dado mais sensivel que nome de deposito/caixa). Corrigido aqui
-- tambem: empresas ganha "escopo de operacao" restrito a empresa DONA da operacao atual da sessao
-- (join por operacoes.empresa_id, ja que empresas nao tem operacao_id direto -- uma empresa tem
-- varias operacoes).
--
-- O QUE MAIS FAZ:
--   1. cadastrar_produto_catalogo(): cria o produto (pai) e a(s) variacao(oes) numa unica transacao --
--      a trigger deferida "produto sem variacao nao existe" (etapa 3) so aceita isso feito assim; duas
--      chamadas separadas do cliente falhariam, porque cada INSERT do PostgREST e sua propria
--      transacao. Fica em vigor a mesma checagem de papel (admin/estoque) e de operacao (VAREJO).
--   2. buscar_variacoes_operacao(): SOMENTE ADMIN, unico ponto que busca o catalogo de UMA OPERACAO
--      ESPECIFICA independente do contexto atual da sessao -- necessario pra tela de Transferencia
--      (o admin fica no contexto ATACADO e precisa escolher a variacao de DESTINO no VAREJO). Nao
--      devolve custo. Efeito colateral aceito e documentado: e a segunda excecao consciente (depois
--      de transferir_estoque) que cruza operacoes, sempre atras de checagem de papel explicita.
--   3. admin_supervisores: view sem pin_hash pra tela de gestao de supervisores (a tabela em si nao
--      tem nenhuma policy de SELECT -- nem para admin -- de proposito, entao sem esta view a lista de
--      supervisores fica ilegivel pelo app).
--
-- COMO RODAR: igual as etapas anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').

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
  select 'T ' || c.relname || ' ' || c.relkind::text as item
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
  union all
  select 'C ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'I ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'P ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'G ' || tgrelid::regclass::text || ' ' || tgname
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.cadastrar_produto_catalogo(text, text, jsonb)') is not null then
    raise exception 'ABORTADO: etapa 5c parece ja aplicada (cadastrar_produto_catalogo existe).';
  end if;
  if to_regclass('public.catalogo_produtos') is null then
    raise exception 'ABORTADO: etapa 3 nao aplicada (catalogo_produtos ausente).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'caixas' and column_name = 'deposito_id') then
    raise exception 'ABORTADO: etapa 4 nao aplicada (caixas.deposito_id ausente).';
  end if;

  -- 1. Correcao de RLS: depositos e caixas passam a respeitar a operacao atual da sessao -----------
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'depositos' and policyname = 'escopo de operacao') then
    create policy "escopo de operacao" on public.depositos as restrictive for all to public
      using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'caixas' and policyname = 'escopo de operacao') then
    create policy "escopo de operacao" on public.caixas as restrictive for all to public
      using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'empresas' and policyname = 'escopo de operacao') then
    create policy "escopo de operacao" on public.empresas as restrictive for all to public
      using (id = (select o.empresa_id from public.operacoes o where o.id = (select public.operacao_atual())))
      with check (id = (select o.empresa_id from public.operacoes o where o.id = (select public.operacao_atual())));
  end if;

  -- 2. cadastrar_produto_catalogo: pai + variacoes numa unica transacao ----------------------------
  create or replace function public.cadastrar_produto_catalogo(p_nome text, p_categoria text, p_variacoes jsonb) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_prod uuid;
    v_item jsonb;
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_variacoes is null or jsonb_typeof(p_variacoes) <> 'array' or jsonb_array_length(p_variacoes) = 0 then
      raise exception 'O produto precisa de ao menos uma variacao';
    end if;

    insert into public.catalogo_produtos (nome, categoria) values (trim(p_nome), nullif(trim(coalesce(p_categoria, '')), ''))
    returning id into v_prod;

    for v_item in select e from jsonb_array_elements(p_variacoes) e loop
      if coalesce(v_item ->> 'sku', '') = '' then
        raise exception 'Informe o SKU de cada variacao';
      end if;
      if nullif(v_item ->> 'preco_venda', '')::numeric is null or (v_item ->> 'preco_venda')::numeric < 0 then
        raise exception 'Informe o preco de venda de cada variacao (%)', v_item ->> 'sku';
      end if;
      insert into public.catalogo_variacoes (produto_id, sku, atributos, preco_venda, preco_minimo)
      values (v_prod, v_item ->> 'sku', coalesce(v_item -> 'atributos', '{}'::jsonb),
        public.arredondar_moeda((v_item ->> 'preco_venda')::numeric),
        case when nullif(v_item ->> 'preco_minimo', '') is not null then public.arredondar_moeda((v_item ->> 'preco_minimo')::numeric) else null end);
    end loop;

    return v_prod;
  end
  $fn$;
  revoke execute on function public.cadastrar_produto_catalogo(text, text, jsonb) from public, anon, authenticated;
  grant execute on function public.cadastrar_produto_catalogo(text, text, jsonb) to authenticated;

  -- 3. buscar_variacoes_operacao: unico ponto que busca catalogo de outra operacao (so admin) ------
  create or replace function public.buscar_variacoes_operacao(p_operacao_codigo text, p_termo text default null)
  returns table(variacao_id uuid, produto_id uuid, nome text, categoria text, sku text, preco_venda numeric)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    return query
      select v.id, p.id, p.nome, p.categoria, v.sku, v.preco_venda
        from public.catalogo_variacoes v
        join public.catalogo_produtos p on p.id = v.produto_id and p.operacao_id = v.operacao_id
        join public.operacoes o on o.id = v.operacao_id
       where o.codigo = p_operacao_codigo and v.ativo and p.ativo
         and (nullif(trim(p_termo), '') is null or p.nome ilike '%' || trim(p_termo) || '%' or v.sku ilike '%' || trim(p_termo) || '%')
       order by p.nome, v.sku
       limit 50;
  end
  $fn$;
  revoke execute on function public.buscar_variacoes_operacao(text, text) from public, anon, authenticated;
  grant execute on function public.buscar_variacoes_operacao(text, text) to authenticated;

  -- 4. admin_supervisores: lista de supervisores sem o hash do PIN ---------------------------------
  create view public.admin_supervisores as
    select sv.profile_id, p.nome, sv.ativo, sv.tentativas_falhas, sv.bloqueado_ate, sv.criado_em, sv.atualizado_em
      from public.supervisores sv
      join public.profiles p on p.id = sv.profile_id
     where sv.operacao_id = (select public.operacao_atual())
       and public.meu_papel() = 'admin'::public.papel_usuario;
  revoke all on public.admin_supervisores from anon, authenticated;
  grant select on public.admin_supervisores to authenticated;
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

  select count(*) into v_n from pg_policies where schemaname = 'public' and policyname = 'escopo de operacao'
     and tablename in ('depositos', 'caixas', 'empresas') and permissive = 'RESTRICTIVE';
  if v_n <> 3 then raise exception 'FALHA: politicas restritivas em depositos/caixas/empresas = %, esperado 3', v_n; end if;

  select count(*) into v_n from information_schema.routines
   where routine_schema = 'public' and routine_name in ('cadastrar_produto_catalogo', 'buscar_variacoes_operacao');
  if v_n <> 2 then raise exception 'FALHA: funcoes novas = %, esperado 2', v_n; end if;

  select count(*) into v_n from pg_class where relnamespace = 'public'::regnamespace and relname = 'admin_supervisores' and relkind = 'v';
  if v_n <> 1 then raise exception 'FALHA: view admin_supervisores ausente'; end if;

  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name = 'admin_supervisores' and column_name = 'pin_hash';
  if v_n <> 0 then raise exception 'FALHA: admin_supervisores expoe pin_hash'; end if;

  raise notice 'VERIFICACAO OK: RLS de depositos/caixas/empresas corrigida, 2 funcoes novas, view de supervisores sem hash.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_prod uuid;
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  update public.operacoes set ativo = true where id = v_varejo;
  delete from public.usuario_operacoes where profile_id = v_barbara and operacao_id = v_atacado;
  insert into public.usuario_operacoes (profile_id, operacao_id, padrao) values (v_barbara, v_varejo, true);

  -- T1. Barbara (so VAREJO) so ve o caixa do VAREJO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.caixas;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: Barbara viu % caixas, esperado 1 (so o VAREJO)', v_n; end if;
  execute 'reset role';

  -- T2. Lucas (admin, ATACADO e VAREJO) so ve os caixas da operacao ATUAL do contexto
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.caixas where operacao_id = v_atacado;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T2]: Lucas em contexto VAREJO ainda viu % caixas do ATACADO', v_n; end if;
  execute 'reset role';

  -- T2b. empresas: Lucas (ligado a duas operacoes) so ve a empresa da operacao ATUAL. Cria uma
  -- segunda empresa/operacao fake dentro desta transacao (desfeita no fim do ensaio) so pra provar
  -- que a politica nova isola por empresa dona da operacao, nao por "qualquer operacao do usuario".
  declare
    v_empresa_zz uuid;
    v_operacao_zz uuid;
  begin
    insert into public.empresas (razao_social, cnpj) values ('ZZ ENSAIO EMPRESA', '00000000000191') returning id into v_empresa_zz;
    insert into public.operacoes (empresa_id, codigo, nome, ativo) values (v_empresa_zz, 'ZZFAKE', 'ZZ FAKE', true) returning id into v_operacao_zz;
    insert into public.usuario_operacoes (profile_id, operacao_id) values (v_lucas, v_operacao_zz);

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.empresas;
    if v_n <> 1 then raise exception 'TESTE FALHOU [T2b]: Lucas em contexto VAREJO viu % empresas, esperado 1 (so a dona do VAREJO)', v_n; end if;
    select count(*) into v_n from public.empresas where id = v_empresa_zz;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T2b]: Lucas viu a empresa ZZ FAKE fora do contexto dela'; end if;
    execute 'reset role';
  end;

  -- T3. cadastrar_produto_catalogo cria pai + 2 variacoes numa unica chamada; vendedor nao pode
  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO 5C', 'ANEL', jsonb_build_array(
    jsonb_build_object('sku', 'ZZ5C-A', 'preco_venda', 100, 'preco_minimo', 90),
    jsonb_build_object('sku', 'ZZ5C-B', 'preco_venda', 50)));
  select count(*) into v_n from public.catalogo_variacoes where produto_id = v_prod;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T3]: variacoes criadas = %, esperado 2', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.cadastrar_produto_catalogo('ZZ NAO PODE', null, jsonb_build_array(jsonb_build_object('sku', 'X', 'preco_venda', 1)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T3]: vendedora cadastrou produto no catalogo'; end if;
  execute 'reset role';

  -- T4. buscar_variacoes_operacao: so admin, cruza operacao (ATACADO chamando por VAREJO), sem custo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.buscar_variacoes_operacao('VAREJO', 'ENSAIO 5C');
  if v_n <> 2 then raise exception 'TESTE FALHOU [T4]: busca cruzada devolveu % linhas, esperado 2', v_n; end if;
  select count(*) into v_n from public.catalogo_variacoes;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T4]: contexto ATACADO ainda enxerga catalogo_variacoes (% linhas, esperado 0)', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.buscar_variacoes_operacao('VAREJO', null);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: vendedora chamou buscar_variacoes_operacao'; end if;
  execute 'reset role';

  -- T5. admin_supervisores: sem policy de select na tabela (ninguem le direto); a view nao tem hash
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  perform public.definir_pin_supervisor(v_lucas, '4321');
  v_ok := false;
  begin
    execute 'select count(*) from public.supervisores';
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: alguem leu a tabela supervisores direto'; end if;
  select count(*) into v_n from public.admin_supervisores where profile_id = v_lucas;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T5]: admin_supervisores nao listou o proprio Lucas'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T5 (RLS de caixas/depositos corrigida, cadastro de catalogo, busca cruzada admin-only, view de supervisores).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop view if exists public.admin_supervisores;
  drop function if exists public.buscar_variacoes_operacao(text, text);
  drop function if exists public.cadastrar_produto_catalogo(text, text, jsonb);
  drop policy if exists "escopo de operacao" on public.empresas;
  drop policy if exists "escopo de operacao" on public.caixas;
  drop policy if exists "escopo de operacao" on public.depositos;
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
    select 'T ' || c.relname || ' ' || c.relkind::text as item
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
    union all
    select 'C ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
      from information_schema.columns where table_schema = 'public'
    union all
    select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      from pg_constraint where connamespace = 'public'::regnamespace
    union all
    select 'I ' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select 'P ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
      from pg_policies where schemaname in ('public', 'storage')
    union all
    select 'G ' || tgrelid::regclass::text || ' ' || tgname
      from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
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

  raise exception 'ENSAIO OK: etapa 5c aplicada, verificada, testada (T1 a T5) e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
