-- Pedido do usuario (2026-09-29): cadastro do catalogo Varejo passa a usar o MESMO sistema ja
-- construido pro PDV Eventos -- bipar codigo (leitor USB/camera), codigo sugerido automaticamente
-- (em vez de digitado a mao) e foto (upload local ou pareamento com a camera do celular via QR).
-- Decisao confirmada com o usuario: o campo que vira "o codigo" (sugerido, impresso, lido de volta)
-- e o sku ja existente -- nao o codigo_barras (que continua no schema, sem uso, como ja estava).
--
-- Pre-requisito: etapa 3 (catalogo_produtos/catalogo_variacoes, migration 20260921000003) e etapa
-- 5c (cadastrar_produto_catalogo, migration 20260922000001).
--
-- O QUE FAZ (uma transacao so):
--   1. catalogo_variacoes ganha foto_url text (mesmo padrao de produtos_evento.foto_url, migration
--      20260819000001) -- foto por variacao (por peca), nao por produto pai.
--   2. Sequencia + trigger definir_sku_variacao_catalogo(): sku em branco na hora de inserir vira o
--      proximo numero da sequencia -- mesmo padrao de definir_codigo_produto_evento (migration
--      20260813000001). O componente CampoCodigoProduto (front-end) ja sugere um codigo com prefixo
--      por categoria antes de enviar; a sequencia e so a rede de seguranca de quando o campo fica
--      vazio mesmo (sku e NOT NULL, sem trigger de update, so de insert).
--   3. cadastrar_produto_catalogo() reescrita: sku deixa de ser obrigatorio (o trigger cobre),
--      passa a aceitar foto_url por variacao no jsonb. Mesma assinatura (text, text, jsonb) --
--      create or replace preserva os grants, sem risco de ficar duas versoes sobrepostas.
--   4. editar_produto_catalogo() nova: edita nome/categoria do produto pai + sku/atributos/preco/
--      foto/ativo de UMA variacao (peca) -- e o que falta pro fluxo "bipar codigo -> achou -> abre
--      pra editar" funcionar (so existia o caminho de criar, nao de editar).
--   5. fotos_celular_pendentes.prefixo ganha 'varejo' como terceiro valor aceito (era so 'manual'
--      e 'evento') -- reaproveita o mesmo mecanismo de pareamento por QR sem tabela nova.
--
-- Nao mexe em codigo_barras (fora de escopo, decisao do usuario) nem em nenhuma tela -- as mudancas
-- de front-end (CampoCodigoProduto, CampoFotoProduto, LeitorCodigoModal, formulario de peca do
-- catalogo) vao no mesmo commit desta migration, fora do que roda no SQL Editor.
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
    select 'COL foto_url' as item where exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'catalogo_variacoes' and column_name = 'foto_url'
    )
    union all
    select 'SEQ catalogo_variacoes_sku_seq' where to_regclass('public.catalogo_variacoes_sku_seq') is not null
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('cadastrar_produto_catalogo', 'editar_produto_catalogo', 'definir_sku_variacao_catalogo')
    union all
    select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('editar_produto_catalogo', 'definir_sku_variacao_catalogo')
    union all
    select 'CHK ' || pg_get_constraintdef(c.oid)
      from pg_constraint c where c.conrelid = 'public.fotos_celular_pendentes'::regclass and c.conname = 'fotos_celular_pendentes_prefixo_check'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  -- 1. Foto por variacao -----------------------------------------------------------------------
  alter table public.catalogo_variacoes add column if not exists foto_url text;

  -- 2. sku auto-numerado quando em branco (mesmo padrao de codigo_interno em produtos_evento) ----
  create sequence if not exists public.catalogo_variacoes_sku_seq;

  create or replace function public.definir_sku_variacao_catalogo() returns trigger
  language plpgsql as $fn$
  begin
    if new.sku is null or btrim(new.sku) = '' then
      new.sku := nextval('public.catalogo_variacoes_sku_seq')::text;
    end if;
    return new;
  end
  $fn$;
  revoke execute on function public.definir_sku_variacao_catalogo() from anon, authenticated, public;

  drop trigger if exists trg_catalogo_variacoes_sku on public.catalogo_variacoes;
  create trigger trg_catalogo_variacoes_sku
    before insert on public.catalogo_variacoes
    for each row
    execute function public.definir_sku_variacao_catalogo();

  -- 3. cadastrar_produto_catalogo: sku deixa de ser obrigatorio, ganha foto_url por variacao -----
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
  -- Mesma assinatura de antes (text, text, jsonb) -- create or replace preserva os grants ja
  -- corretos (revoke de anon/public, so authenticated), sem precisar repetir aqui.

  -- 4. editar_produto_catalogo: nova -- fecha o fluxo "bipou, achou, abre pra editar" ------------
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

  -- 5. Pareamento de camera do celular tambem pro catalogo Varejo ---------------------------------
  alter table public.fotos_celular_pendentes drop constraint if exists fotos_celular_pendentes_prefixo_check;
  alter table public.fotos_celular_pendentes add constraint fotos_celular_pendentes_prefixo_check
    check (prefixo in ('manual', 'evento', 'varejo'));
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
  v_def text;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalogo_variacoes' and column_name = 'foto_url') then
    raise exception 'FALHA: catalogo_variacoes.foto_url nao existe';
  end if;
  if to_regclass('public.catalogo_variacoes_sku_seq') is null then
    raise exception 'FALHA: sequencia catalogo_variacoes_sku_seq nao existe';
  end if;
  if to_regprocedure('public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean)') is null then
    raise exception 'FALHA: editar_produto_catalogo nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em editar_produto_catalogo';
  end if;
  if has_function_privilege('anon', 'public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean)', 'execute') then
    raise exception 'FALHA: anon com execute em editar_produto_catalogo';
  end if;
  if has_function_privilege('anon', 'public.definir_sku_variacao_catalogo()', 'execute') then
    raise exception 'FALHA: anon com execute em definir_sku_variacao_catalogo';
  end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.fotos_celular_pendentes'::regclass and conname = 'fotos_celular_pendentes_prefixo_check';
  if v_def is null or v_def not like '%varejo%' then
    raise exception 'FALHA: constraint de prefixo nao inclui varejo';
  end if;

  raise notice 'VERIFICACAO OK: foto_url, sequencia/trigger de sku, editar_produto_catalogo e constraint de prefixo, tudo no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_prod uuid;
  v_var uuid;
  v_sku text;
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. sku em branco na criacao -> auto-numerado pela sequencia, produto criado com foto_url
  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO CATALOGO BIP', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', '', 'atributos', '{}'::jsonb, 'preco_venda', 199.90, 'foto_url', 'https://exemplo/foto1.jpg')));
  select id, sku into v_var, v_sku from public.catalogo_variacoes where produto_id = v_prod;
  if v_sku is null or btrim(v_sku) = '' then raise exception 'TESTE FALHOU [T1]: sku ficou em branco'; end if;
  select count(*) into v_n from public.catalogo_variacoes where id = v_var and foto_url = 'https://exemplo/foto1.jpg';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: foto_url nao foi gravada na criacao'; end if;

  -- T2. sku digitado na criacao -> respeitado, sem sobrescrever pela sequencia
  perform public.cadastrar_produto_catalogo('ZZ ENSAIO CATALOGO BIP 2', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZBIP01', 'atributos', '{}'::jsonb, 'preco_venda', 50)));
  select count(*) into v_n from public.catalogo_variacoes where sku = 'ZZBIP01';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: sku digitado nao foi respeitado'; end if;

  -- T3. editar_produto_catalogo: muda nome do produto, sku/preco/foto/ativo da variacao
  perform public.editar_produto_catalogo(v_prod, v_var, 'ZZ ENSAIO CATALOGO EDITADO', 'COLAR',
    'ZZBIPEDIT', '{"cor":"prata"}'::jsonb, 249.90, 200.00, 'https://exemplo/foto2.jpg', false);
  select count(*) into v_n from public.catalogo_produtos where id = v_prod and nome = 'ZZ ENSAIO CATALOGO EDITADO' and categoria = 'COLAR';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: nome/categoria do produto nao foram atualizados'; end if;
  select count(*) into v_n from public.catalogo_variacoes
   where id = v_var and sku = 'ZZBIPEDIT' and preco_venda = 249.90 and preco_minimo = 200.00
     and foto_url = 'https://exemplo/foto2.jpg' and ativo = false and (atributos ->> 'cor') = 'prata';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: variacao nao foi atualizada como esperado'; end if;

  -- T4. editar_produto_catalogo com sku em branco -> mantem o sku atual (nao apaga, NOT NULL)
  perform public.editar_produto_catalogo(v_prod, v_var, 'ZZ ENSAIO CATALOGO EDITADO', 'COLAR',
    '', '{}'::jsonb, 249.90, null, 'https://exemplo/foto2.jpg', true);
  select count(*) into v_n from public.catalogo_variacoes where id = v_var and sku = 'ZZBIPEDIT';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: sku em branco na edicao apagou o sku existente'; end if;

  -- T5. editar_produto_catalogo recusa variacao/produto de outra operacao (guarda por operacao)
  v_ok := false;
  begin
    perform public.editar_produto_catalogo(gen_random_uuid(), gen_random_uuid(), 'X', null, null, '{}'::jsonb, 10, null, null, true);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: editou produto/variacao inexistente sem erro'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T5 (sku auto-numerado, sku digitado respeitado, edicao completa, sku em branco preserva, guarda contra id inexistente).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean);

  drop trigger if exists trg_catalogo_variacoes_sku on public.catalogo_variacoes;
  drop function if exists public.definir_sku_variacao_catalogo();
  drop sequence if exists public.catalogo_variacoes_sku_seq;

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

  alter table public.catalogo_variacoes drop column if exists foto_url;

  alter table public.fotos_celular_pendentes drop constraint if exists fotos_celular_pendentes_prefixo_check;
  alter table public.fotos_celular_pendentes add constraint fotos_celular_pendentes_prefixo_check
    check (prefixo in ('manual', 'evento'));
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
      select 'COL foto_url' as item where exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'catalogo_variacoes' and column_name = 'foto_url'
      )
      union all
      select 'SEQ catalogo_variacoes_sku_seq' where to_regclass('public.catalogo_variacoes_sku_seq') is not null
      union all
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('cadastrar_produto_catalogo', 'editar_produto_catalogo', 'definir_sku_variacao_catalogo')
      union all
      select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('editar_produto_catalogo', 'definir_sku_variacao_catalogo')
      union all
      select 'CHK ' || pg_get_constraintdef(c.oid)
        from pg_constraint c where c.conrelid = 'public.fotos_celular_pendentes'::regclass and c.conname = 'fotos_celular_pendentes_prefixo_check'
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

  raise exception 'ENSAIO OK: catalogo Varejo com sku auto-numerado + foto por variacao + edicao completa, testado (T1 a T5) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
