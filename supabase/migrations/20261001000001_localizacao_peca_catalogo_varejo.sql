-- Pedido do usuario (2026-10-01): campo de localizacao fisica da peca no cadastro do catalogo
-- Varejo -- onde ela fica guardada na loja (carrinho, gaveta, bandeja, gancho, etc). Exemplo dado:
-- "carrinho 1, gaveta 2, bandeja 1, gancho 8". Mesmo formato de texto livre "chave valor, chave
-- valor" ja usado no campo Atributos (parseAtributos/formatarAtributos, src/lib/varejo/atributos.ts)
-- -- reaproveitado tal e qual, so um campo/coluna novo, sem parser novo nenhum.
--
-- Pre-requisito: etapa 20260929000001 (foto_url, cadastrar_produto_catalogo/editar_produto_catalogo).
--
-- O QUE FAZ (uma transacao so):
--   1. catalogo_variacoes ganha localizacao jsonb (default '{}', mesmo padrao de atributos).
--   2. cadastrar_produto_catalogo() passa a aceitar localizacao por variacao no jsonb -- mesma
--      assinatura (text, text, jsonb), create or replace preserva os grants.
--   3. editar_produto_catalogo() ganha p_localizacao (novo ultimo parametro, default '{}') --
--      precisa derrubar a assinatura antiga primeiro (mesmo cuidado de toda vez que um parametro
--      novo entra numa function ja existente).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve tudo ao
-- -- estado anterior, testado pelo proprio modo 'ensaio' antes de chegar aqui):
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque so esta linha): 'ensaio' | 'aplicar' | 'desfazer'
select set_config('app.modo_migration', 'aplicar', true);
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
    select 'COL localizacao' as item where exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'catalogo_variacoes' and column_name = 'localizacao'
    )
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('cadastrar_produto_catalogo', 'editar_produto_catalogo')
    union all
    select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'editar_produto_catalogo'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  alter table public.catalogo_variacoes add column if not exists localizacao jsonb not null default '{}'::jsonb;

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
      if nullif(v_item ->> 'preco_venda', '')::numeric is null or (v_item ->> 'preco_venda')::numeric < 0 then
        raise exception 'Informe o preco de venda de cada variacao';
      end if;
      insert into public.catalogo_variacoes (produto_id, sku, atributos, preco_venda, preco_minimo, foto_url, localizacao)
      values (v_prod, nullif(trim(coalesce(v_item ->> 'sku', '')), ''), coalesce(v_item -> 'atributos', '{}'::jsonb),
        public.arredondar_moeda((v_item ->> 'preco_venda')::numeric),
        case when nullif(v_item ->> 'preco_minimo', '') is not null then public.arredondar_moeda((v_item ->> 'preco_minimo')::numeric) else null end,
        nullif(v_item ->> 'foto_url', ''), coalesce(v_item -> 'localizacao', '{}'::jsonb));
    end loop;

    return v_prod;
  end
  $fn$;
  -- Mesma assinatura de antes (text, text, jsonb) -- create or replace preserva os grants.

  drop function if exists public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean);

  create or replace function public.editar_produto_catalogo(
    p_produto_id uuid, p_variacao_id uuid, p_nome text, p_categoria text, p_sku text,
    p_atributos jsonb, p_preco_venda numeric, p_preco_minimo numeric, p_foto_url text, p_ativo boolean,
    p_localizacao jsonb default '{}'::jsonb
  ) returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_preco_venda is null or p_preco_venda < 0 then
      raise exception 'Informe o preco de venda';
    end if;

    update public.catalogo_produtos
       set nome = trim(p_nome), categoria = nullif(trim(coalesce(p_categoria, '')), ''), atualizado_em = now()
     where id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Produto nao encontrado';
    end if;

    -- sku em branco mantem o atual (NOT NULL, sem forma de "limpar" -- mesmo padrao de
    -- codigo_interno em salvarProdutoEvento): so entra no SET quando veio preenchido.
    update public.catalogo_variacoes
       set sku = coalesce(v_sku, sku),
           atributos = coalesce(p_atributos, '{}'::jsonb),
           preco_venda = public.arredondar_moeda(p_preco_venda),
           preco_minimo = case when p_preco_minimo is not null then public.arredondar_moeda(p_preco_minimo) else null end,
           foto_url = p_foto_url,
           ativo = p_ativo,
           localizacao = coalesce(p_localizacao, '{}'::jsonb),
           atualizado_em = now()
     where id = p_variacao_id and produto_id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Variacao nao encontrada';
    end if;
  end
  $fn$;
  revoke execute on function public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb) from anon, authenticated, public;
  grant execute on function public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb) to authenticated;
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

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalogo_variacoes' and column_name = 'localizacao') then
    raise exception 'FALHA: catalogo_variacoes.localizacao nao existe';
  end if;

  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'editar_produto_catalogo';
  if v_n <> 1 then raise exception 'FALHA: existe(m) % versao(oes) de editar_produto_catalogo, esperado exatamente 1', v_n; end if;

  if to_regprocedure('public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb)') is null then
    raise exception 'FALHA: editar_produto_catalogo com o parametro novo nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em editar_produto_catalogo';
  end if;
  if has_function_privilege('anon', 'public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb)', 'execute') then
    raise exception 'FALHA: anon com execute em editar_produto_catalogo';
  end if;

  raise notice 'VERIFICACAO OK: coluna localizacao e functions atualizadas, tudo no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_prod uuid;
  v_var uuid;
  v_n bigint;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. Cadastro com localizacao -> gravada certa
  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO LOCALIZACAO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ-LOC-01', 'preco_venda', 100,
      'localizacao', jsonb_build_object('carrinho', '1', 'gaveta', '2', 'bandeja', '1', 'gancho', '8'))));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;
  select count(*) into v_n from public.catalogo_variacoes
   where id = v_var and (localizacao ->> 'carrinho') = '1' and (localizacao ->> 'gaveta') = '2'
     and (localizacao ->> 'bandeja') = '1' and (localizacao ->> 'gancho') = '8';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: localizacao nao foi gravada certa na criacao'; end if;

  -- T2. Cadastro sem localizacao -> vira objeto vazio, nao null (coluna is not null)
  perform public.cadastrar_produto_catalogo('ZZ ENSAIO LOCALIZACAO 2', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ-LOC-02', 'preco_venda', 50)));
  select count(*) into v_n from public.catalogo_variacoes where sku = 'ZZ-LOC-02' and localizacao = '{}'::jsonb;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: localizacao ausente nao virou objeto vazio'; end if;

  -- T3. editar_produto_catalogo atualiza a localizacao
  perform public.editar_produto_catalogo(v_prod, v_var, 'ZZ ENSAIO LOCALIZACAO', 'ANEL', 'ZZ-LOC-01',
    '{}'::jsonb, 100, null, null, true, jsonb_build_object('vitrine', '3'));
  select count(*) into v_n from public.catalogo_variacoes where id = v_var and (localizacao ->> 'vitrine') = '3';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: editar_produto_catalogo nao atualizou a localizacao'; end if;

  -- T4. editar_produto_catalogo sem passar localizacao (default) -> vira objeto vazio, nao quebra
  perform public.editar_produto_catalogo(v_prod, v_var, 'ZZ ENSAIO LOCALIZACAO', 'ANEL', 'ZZ-LOC-01', '{}'::jsonb, 100, null, null, true);
  select count(*) into v_n from public.catalogo_variacoes where id = v_var and localizacao = '{}'::jsonb;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: editar sem informar localizacao nao usou o default'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T4 (localizacao gravada na criacao, default vazio, atualizada na edicao, default na edicao sem informar).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb);

  create or replace function public.editar_produto_catalogo(
    p_produto_id uuid, p_variacao_id uuid, p_nome text, p_categoria text, p_sku text,
    p_atributos jsonb, p_preco_venda numeric, p_preco_minimo numeric, p_foto_url text, p_ativo boolean
  ) returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_preco_venda is null or p_preco_venda < 0 then
      raise exception 'Informe o preco de venda';
    end if;

    update public.catalogo_produtos
       set nome = trim(p_nome), categoria = nullif(trim(coalesce(p_categoria, '')), ''), atualizado_em = now()
     where id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Produto nao encontrado';
    end if;

    -- sku em branco mantem o atual (NOT NULL, sem forma de "limpar" -- mesmo padrao de
    -- codigo_interno em salvarProdutoEvento): so entra no SET quando veio preenchido.
    update public.catalogo_variacoes
       set sku = coalesce(v_sku, sku),
           atributos = coalesce(p_atributos, '{}'::jsonb),
           preco_venda = public.arredondar_moeda(p_preco_venda),
           preco_minimo = case when p_preco_minimo is not null then public.arredondar_moeda(p_preco_minimo) else null end,
           foto_url = p_foto_url,
           ativo = p_ativo,
           atualizado_em = now()
     where id = p_variacao_id and produto_id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Variacao nao encontrada';
    end if;
  end
  $fn$;
  revoke execute on function public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean) from anon, authenticated, public;
  grant execute on function public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean) to authenticated;

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
      if nullif(v_item ->> 'preco_venda', '')::numeric is null or (v_item ->> 'preco_venda')::numeric < 0 then
        raise exception 'Informe o preco de venda de cada variacao';
      end if;
      insert into public.catalogo_variacoes (produto_id, sku, atributos, preco_venda, preco_minimo, foto_url)
      values (v_prod, nullif(trim(coalesce(v_item ->> 'sku', '')), ''), coalesce(v_item -> 'atributos', '{}'::jsonb),
        public.arredondar_moeda((v_item ->> 'preco_venda')::numeric),
        case when nullif(v_item ->> 'preco_minimo', '') is not null then public.arredondar_moeda((v_item ->> 'preco_minimo')::numeric) else null end,
        nullif(v_item ->> 'foto_url', ''));
    end loop;

    return v_prod;
  end
  $fn$;

  alter table public.catalogo_variacoes drop column if exists localizacao;
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
      select 'COL localizacao' as item where exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'catalogo_variacoes' and column_name = 'localizacao'
      )
      union all
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('cadastrar_produto_catalogo', 'editar_produto_catalogo')
      union all
      select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'editar_produto_catalogo'
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

  raise exception 'ENSAIO OK: localizacao da peca (carrinho/gaveta/bandeja/gancho) no catalogo Varejo, testado (T1 a T4) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
