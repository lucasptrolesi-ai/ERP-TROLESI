-- PDV Varejo ganha painel "Meta do dia" (faturamento de hoje + meta configurável + grafico de 7
-- dias) e o catalogo passa a mostrar foto real da peca em vez de so texto -- pedido do usuario,
-- 2026-10-27, depois de aprovar o mockup (Artifact) com anel de progresso + grade de fotos.
--
-- `varejo_config` ganha `meta_diaria numeric` (default 500, o valor que o usuario pediu) -- mora
-- junto dos outros parametros editaveis em "Nova vigencia" (/varejo/financeiro, aba Configuracao),
-- mesmo padrao insert-only ja usado pelos outros campos dessa tabela. NAO e um valor fixo no
-- codigo -- o usuario pediu explicitamente "quero que fique configuravel".
--
-- `pdv_catalogo` (view) ganha `foto_url` no final da lista de colunas (unica posicao permitida
-- por CREATE OR REPLACE VIEW sem derrubar a view -- colunas existentes nunca podem ser removidas/
-- reordenadas, so uma coluna nova no fim). `catalogo_variacoes.foto_url` ja existe desde a feature
-- de foto por celular -- so nao estava exposta nessa view ainda.
--
-- Faturamento de hoje/ultimos 7 dias NAO precisa de view/RPC nova: a RLS de `vendas` ja permite
-- qualquer papel autenticado ler todas as vendas da operacao atual (policy "escopo de operacao",
-- sem filtro de papel) -- so a VIEW pdv_vendas que estreita pra sessao do proprio operador, de
-- proposito, pra outro caso de uso (cancelar venda). O server component do PDV busca direto na
-- tabela `vendas` (so criada_em + total -- nunca custo/margem, regra do modulo de varejo).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Devolve pdv_catalogo sem foto_url e remove varejo_config.meta_diaria (perde so o
-- -- valor da meta configurada, recriavel a qualquer momento -- nao e dado financeiro real).
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

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  alter table public.varejo_config add column meta_diaria numeric not null default 500 check (meta_diaria > 0);

  create or replace view public.pdv_catalogo as
  select
    v.id as variacao_id,
    v.operacao_id,
    p.id as produto_id,
    p.nome,
    p.categoria,
    v.sku,
    v.codigo_barras,
    v.atributos,
    v.preco_venda,
    v.preco_minimo,
    coalesce(
      (select sum(m.quantidade) from public.estoque_movimentos m
        where m.variacao_id = v.id and m.operacao_id = v.operacao_id),
      0::bigint
    )::integer as saldo,
    v.foto_url
  from public.catalogo_variacoes v
  join public.catalogo_produtos p on p.id = v.produto_id and p.operacao_id = v.operacao_id
  where v.ativo and p.ativo and v.operacao_id = (select public.operacao_atual());
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'varejo_config' and column_name = 'meta_diaria'
  ) then
    raise exception 'FALHA: varejo_config.meta_diaria nao existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pdv_catalogo' and column_name = 'foto_url'
  ) then
    raise exception 'FALHA: pdv_catalogo.foto_url nao existe';
  end if;

  raise notice 'VERIFICACAO OK: varejo_config.meta_diaria e pdv_catalogo.foto_url no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_varejo uuid;
  v_meta numeric;
  v_var_foto uuid;
  v_foto_direta text;
  v_foto_view text;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. Config existente ganhou meta_diaria = 500 (default) sem precisar de migracao de dado.
  select meta_diaria into v_meta from public.varejo_config order by vigente_desde desc limit 1;
  if v_meta is null or v_meta <> 500 then
    raise exception 'TESTE FALHOU [T1]: meta_diaria deveria ser 500 por default, veio %', v_meta;
  end if;

  -- T2. pdv_catalogo.foto_url bate exatamente com catalogo_variacoes.foto_url da mesma peca
  -- (pega qualquer variacao ativa com foto cadastrada; se nenhuma tiver, compara null com null).
  select v.id, v.foto_url into v_var_foto, v_foto_direta
    from public.catalogo_variacoes v
    join public.catalogo_produtos p on p.id = v.produto_id
   where v.ativo and p.ativo and v.operacao_id = v_varejo
   order by (v.foto_url is not null) desc, v.atualizado_em desc
   limit 1;
  select foto_url into v_foto_view from public.pdv_catalogo where variacao_id = v_var_foto;
  if v_foto_view is distinct from v_foto_direta then
    raise exception 'TESTE FALHOU [T2]: pdv_catalogo.foto_url (%) nao bate com catalogo_variacoes.foto_url (%)', v_foto_view, v_foto_direta;
  end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 (meta_diaria default 500), T2 (foto_url exposta igual na view).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  create or replace view public.pdv_catalogo as
  select
    v.id as variacao_id,
    v.operacao_id,
    p.id as produto_id,
    p.nome,
    p.categoria,
    v.sku,
    v.codigo_barras,
    v.atributos,
    v.preco_venda,
    v.preco_minimo,
    coalesce(
      (select sum(m.quantidade) from public.estoque_movimentos m
        where m.variacao_id = v.id and m.operacao_id = v.operacao_id),
      0::bigint
    )::integer as saldo
  from public.catalogo_variacoes v
  join public.catalogo_produtos p on p.id = v.produto_id and p.operacao_id = v.operacao_id
  where v.ativo and p.ativo and v.operacao_id = (select public.operacao_atual());

  alter table public.varejo_config drop column if exists meta_diaria;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'varejo_config' and column_name = 'meta_diaria'
  ) or exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pdv_catalogo' and column_name = 'foto_url'
  ) then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: meta_diaria (default 500) e pdv_catalogo.foto_url testados (T1, T2) e desfeitos -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
