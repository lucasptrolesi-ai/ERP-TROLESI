-- Módulo Etiquetas (Fase A, plano do usuário 2026-10-15): editor de modelos de etiqueta tipo
-- BarTender, com elementos ligados a campos da peça, impressão em lote e histórico. Esta migration é
-- só a Fase A: schema + modelo semente ("Joia rabicho", a mesma etiqueta 95x12mm já aprovada e
-- validada fisicamente) + evolução de solicitacoes_etiqueta pra carregar o ZPL já pronto.
--
-- MUDANÇA DE ARQUITETURA (ver DECISIONS.md "Módulo Etiquetas"): até aqui (migration 20261015000001)
-- o print-agent MONTAVA o ZPL (duplicado em TS + JS puro, com teste de consistência). Agora que existe
-- um motor genérico de elementos (src/lib/etiquetas/zpl.ts, modeloParaZpl), duplicar esse motor
-- inteiro em JS puro no print-agent seria réplica grande demais pra manter sincronizada à mão -- o app
-- passa a montar o ZPL completo e gravar pronto na fila (coluna `zpl`); o print-agent só ENVIA,
-- mesmo espírito do modo "rede" do cupom (bytes crus, zero lógica de negócio). Os campos antigos
-- (linha1/preco/linha3/codigo) viram opcionais -- nenhuma linha real existia em produção quando essa
-- mudança foi feita (confirmado antes de alterar), mas a coluna continua aceitando o formato antigo
-- se algum dia precisar.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo (o bloco DO $down$ mais abaixo devolve tudo ao estado anterior, testado pelo próprio modo
-- -- 'ensaio' antes de chegar aqui). ATENÇÃO: o desfazer APAGA qualquer solicitacoes_etiqueta gravada
-- -- só com `zpl` (formato novo, colunas antigas nulas) -- é o preço de restaurar o NOT NULL que o
-- -- formato antigo exige. Não desfaça esta migration depois que o módulo estiver em uso real sem
-- -- aceitar essa perda (ou faça backfill manual de linha1/preco/codigo antes, se quiser preservar).
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque só esta linha): 'ensaio' | 'aplicar' | 'desfazer'
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
    select 'TAB ' || t.table_name as item from information_schema.tables t
     where t.table_schema = 'public' and t.table_name in ('etiqueta_modelos', 'etiqueta_impressoes')
    union all
    select 'COL solicitacoes_etiqueta.' || c.column_name || ' nullable=' || c.is_nullable as item
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'solicitacoes_etiqueta'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_modelo_id uuid;
  v_elementos jsonb;
  v_areas jsonb;
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  -- 1. etiqueta_modelos -----------------------------------------------------------------------
  create table public.etiqueta_modelos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    nome text not null,
    largura_mm numeric(7, 3) not null check (largura_mm > 0),
    altura_mm numeric(7, 3) not null check (altura_mm > 0),
    gap_mm numeric(7, 3),
    -- numeric, nao integer: 203dpi "de fabrica" da Elgin L42 e, na pratica, exatamente 8 dots/mm =
    -- 203.2dpi (a ficha tecnica arredonda pra "203"). O motor (mmParaDots) usa dpi/25.4 reto, entao
    -- o modelo semente abaixo grava 203.2, nao 203 -- ver src/lib/etiquetas/zpl.ts e DECISIONS.md.
    dpi numeric(6, 2) not null default 203.2 check (dpi > 0),
    velocidade integer not null default 2 check (velocidade between 1 and 14),
    escuro integer not null default 5 check (escuro between 0 and 30),
    areas_imprimiveis jsonb not null default '[]'::jsonb,
    elementos jsonb not null default '[]'::jsonb,
    padrao_varejo boolean not null default false,
    ativo boolean not null default true,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
  );
  -- So um modelo padrao por operacao (indice parcial unico em operacao_id, so nas linhas com
  -- padrao_varejo = true).
  create unique index etiqueta_modelos_padrao_unico on public.etiqueta_modelos (operacao_id) where padrao_varejo;

  create trigger trg_carimbar_operacao before insert on public.etiqueta_modelos for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.etiqueta_modelos for each row execute function public.travar_operacao();
  create trigger trg_atualizado_em before update on public.etiqueta_modelos for each row execute function public.set_atualizado_em();

  alter table public.etiqueta_modelos enable row level security;
  create policy "escopo de operacao" on public.etiqueta_modelos as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "admin e estoque gerenciam etiqueta_modelos" on public.etiqueta_modelos for all to authenticated
    using (public.meu_papel() in ('admin'::public.papel_usuario, 'estoque'::public.papel_usuario))
    with check (public.meu_papel() in ('admin'::public.papel_usuario, 'estoque'::public.papel_usuario));

  revoke all on public.etiqueta_modelos from anon, public, authenticated;
  grant select, insert, update, delete on public.etiqueta_modelos to authenticated;

  -- 2. etiqueta_impressoes (historico) ---------------------------------------------------------
  create table public.etiqueta_impressoes (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    solicitacao_id uuid not null references public.solicitacoes_etiqueta (id),
    modelo_id uuid not null references public.etiqueta_modelos (id),
    variacao_id uuid not null references public.catalogo_variacoes (id),
    quantidade integer not null check (quantidade between 1 and 999),
    dados jsonb not null default '{}'::jsonb,
    status text not null default 'pendente' check (status in ('pendente', 'impresso', 'erro')),
    erro text,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    impresso_em timestamptz
  );
  create index etiqueta_impressoes_variacao_idx on public.etiqueta_impressoes (variacao_id, status, criado_em desc);
  create index etiqueta_impressoes_solicitacao_idx on public.etiqueta_impressoes (solicitacao_id);

  create trigger trg_carimbar_operacao before insert on public.etiqueta_impressoes for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.etiqueta_impressoes for each row execute function public.travar_operacao();

  alter table public.etiqueta_impressoes enable row level security;
  create policy "escopo de operacao" on public.etiqueta_impressoes as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "admin e estoque leem e criam etiqueta_impressoes" on public.etiqueta_impressoes for select to authenticated
    using (public.meu_papel() in ('admin'::public.papel_usuario, 'estoque'::public.papel_usuario));
  create policy "admin e estoque inserem etiqueta_impressoes" on public.etiqueta_impressoes for insert to authenticated
    with check (public.meu_papel() in ('admin'::public.papel_usuario, 'estoque'::public.papel_usuario));

  -- Sem update/delete pro app de proposito -- so o print-agent (service_role, bypassa RLS) marca
  -- impresso/erro, mesmo espirito de solicitacoes_impressao/solicitacoes_etiqueta.
  revoke all on public.etiqueta_impressoes from anon, public, authenticated;
  grant select, insert on public.etiqueta_impressoes to authenticated;

  -- 3. Evolui solicitacoes_etiqueta pra carregar o ZPL ja pronto --------------------------------
  alter table public.solicitacoes_etiqueta
    alter column linha1 drop not null,
    alter column preco drop not null,
    alter column codigo drop not null,
    add column zpl text,
    add column modelo_id uuid references public.etiqueta_modelos (id),
    add constraint solicitacoes_etiqueta_zpl_ou_campos_antigos check (
      zpl is not null or (linha1 is not null and preco is not null and codigo is not null)
    );

  -- 4. Modelo semente "Joia rabicho" -- mesma etiqueta 95x12mm ja aprovada/validada fisicamente,
  -- convertida pro formato de elementos. O gerador generico tem que reproduzir este ZPL byte a byte
  -- (testado em src/lib/etiquetas/zpl.test.ts) -- se algum dia este insert mudar, reimprimir e
  -- remedir na etiqueta real antes.
  v_areas := '[
    {"x_mm": 2, "y_mm": 0, "w_mm": 23, "h_mm": 12},
    {"x_mm": 24.5, "y_mm": 0, "w_mm": 18.5, "h_mm": 12},
    {"x_mm": 46, "y_mm": 0, "w_mm": 39, "h_mm": 12}
  ]'::jsonb;

  v_elementos := '[
    {
      "id": "linha1", "nome": "Linha de cima", "tipo": "texto",
      "x_mm": 2, "y_mm": 1.25, "w_mm": 23, "h_mm": 2.25,
      "conteudo": {"origem": "fixo", "texto": "TROLESI"},
      "fonte": {"altura_mm": 2.25, "largura_mm": 2.25, "encolherSeNaoCouber": false},
      "alinhamento": "centro"
    },
    {
      "id": "preco", "nome": "Preço", "tipo": "texto",
      "x_mm": 2, "y_mm": 3.75, "w_mm": 23, "h_mm": 4.25,
      "conteudo": {"origem": "campo", "campo": "preco_venda", "formato": "moeda"},
      "fonte": {"altura_mm": 4.25, "largura_mm": 3.25, "encolherSeNaoCouber": false},
      "alinhamento": "centro"
    },
    {
      "id": "linha3", "nome": "Linha de baixo", "tipo": "texto",
      "x_mm": 2, "y_mm": 8.5, "w_mm": 23, "h_mm": 2.25,
      "conteudo": {"origem": "campo", "campo": "atributos", "campoSeVazio": "categoria"},
      "fonte": {"altura_mm": 2.25, "largura_mm": 1.75, "encolherSeNaoCouber": false},
      "alinhamento": "centro", "maxCaracteres": 20
    },
    {
      "id": "qr", "nome": "QR code", "tipo": "qr",
      "x_mm": 27, "y_mm": 2, "w_mm": 7.875, "h_mm": 7.875,
      "conteudo": {"origem": "campo", "campo": "codigo"},
      "maxCaracteres": 8,
      "qr": {"modulo_dots": 3, "correcao": "M"}
    },
    {
      "id": "sku_label", "nome": "Texto SKU (fixo)", "tipo": "texto",
      "x_mm": 35.625, "y_mm": 3.25, "w_mm": 10, "h_mm": 2.5,
      "conteudo": {"origem": "fixo", "texto": "SKU"},
      "fonte": {"altura_mm": 2.5, "largura_mm": 1.75, "encolherSeNaoCouber": false},
      "alinhamento": "esquerda"
    },
    {
      "id": "codigo", "nome": "Código", "tipo": "texto",
      "x_mm": 35.625, "y_mm": 6.25, "w_mm": 10, "h_mm": 2.5,
      "conteudo": {"origem": "campo", "campo": "codigo"},
      "fonte": {"altura_mm": 2.5, "largura_mm": 1.5, "encolherSeNaoCouber": false},
      "alinhamento": "esquerda", "maxCaracteres": 8
    }
  ]'::jsonb;

  -- carimbar_operacao() recusa operacao_id explicito fora de uma sessao autenticada normal (ele
  -- preenche sozinho, via operacao_atual()) -- este insert roda direto no corpo da migration, sem
  -- sessao nenhuma, entao precisa do mesmo escape hatch que transferir_estoque() ja usa pra gravar
  -- operacao_id na mao (app.transferencia), so pelo tempo deste insert.
  perform set_config('app.transferencia', 'on', true);
  insert into public.etiqueta_modelos
    (operacao_id, nome, largura_mm, altura_mm, dpi, velocidade, escuro, areas_imprimiveis, elementos, padrao_varejo, ativo, criado_por)
  values
    (v_varejo, 'Joia rabicho', 95, 12, 203.2, 2, 5, v_areas, v_elementos, true, true, v_lucas)
  returning id into v_modelo_id;
  perform set_config('app.transferencia', 'off', true);
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_n bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regclass('public.etiqueta_modelos') is null then raise exception 'FALHA: etiqueta_modelos nao existe'; end if;
  if to_regclass('public.etiqueta_impressoes') is null then raise exception 'FALHA: etiqueta_impressoes nao existe'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitacoes_etiqueta' and column_name = 'zpl') then
    raise exception 'FALHA: solicitacoes_etiqueta.zpl nao existe';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitacoes_etiqueta' and column_name = 'modelo_id') then
    raise exception 'FALHA: solicitacoes_etiqueta.modelo_id nao existe';
  end if;

  select count(*) into v_n from public.etiqueta_modelos where nome = 'Joia rabicho' and padrao_varejo;
  if v_n <> 1 then raise exception 'FALHA: modelo semente "Joia rabicho" nao foi criado como padrao'; end if;

  if has_table_privilege('authenticated', 'public.etiqueta_impressoes', 'UPDATE') then
    raise exception 'FALHA: authenticated nao deveria conseguir UPDATE em etiqueta_impressoes (so o print-agent)';
  end if;
  if has_table_privilege('anon', 'public.etiqueta_modelos', 'SELECT') then
    raise exception 'FALHA: anon com select em etiqueta_modelos';
  end if;

  raise notice 'VERIFICACAO OK: tabelas, colunas novas, modelo semente e grants no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_vendedor uuid;
  v_modelo_joia uuid;
  v_modelo2 uuid;
  v_prod uuid;
  v_var uuid;
  v_sol uuid;
  v_n bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_vendedor from public.profiles where papel = 'vendedor' limit 1;
  select id into v_modelo_joia from public.etiqueta_modelos where nome = 'Joia rabicho';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. So um modelo padrao por operacao -- marcar um segundo como padrao deve falhar
  insert into public.etiqueta_modelos (nome, largura_mm, altura_mm, elementos)
    values ('ZZ ENSAIO modelo 2', 60, 40, '[]'::jsonb) returning id into v_modelo2;
  begin
    update public.etiqueta_modelos set padrao_varejo = true where id = v_modelo2;
    raise exception 'TESTE FALHOU [T1]: dois modelos padrao na mesma operacao deveriam ser rejeitados';
  exception when unique_violation then null;
  end;

  -- T2. Nova solicitacao de etiqueta com zpl pronto (fluxo novo) -- nao precisa de linha1/preco/codigo
  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO ETIQUETA MODELO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ002', 'atributos', '{}'::jsonb, 'preco_venda', 99.90)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;

  insert into public.solicitacoes_etiqueta (produto_id, variacao_id, modelo_id, zpl, quantidade)
    values (v_prod, v_var, v_modelo_joia, '^XA^XZ', 2) returning id into v_sol;
  select count(*) into v_n from public.solicitacoes_etiqueta where id = v_sol and zpl = '^XA^XZ' and linha1 is null;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: solicitacao com zpl pronto nao gravou certo (linha1 deveria continuar nula)'; end if;

  -- T3. Check antigo ainda protege: sem zpl E sem os campos antigos, falha
  begin
    insert into public.solicitacoes_etiqueta (produto_id, variacao_id, quantidade) values (v_prod, v_var, 1);
    raise exception 'TESTE FALHOU [T3]: solicitacao sem zpl e sem campos antigos deveria falhar no check';
  exception when check_violation then null;
  end;

  -- T4. etiqueta_impressoes: cria vinculada a solicitacao, so print-agent atualiza status
  insert into public.etiqueta_impressoes (solicitacao_id, modelo_id, variacao_id, quantidade, dados)
    values (v_sol, v_modelo_joia, v_var, 2, '{"codigo":"ZZ002"}'::jsonb);
  begin
    update public.etiqueta_impressoes set status = 'impresso' where solicitacao_id = v_sol;
    raise exception 'TESTE FALHOU [T4]: app conseguiu dar update em etiqueta_impressoes (so o print-agent deveria)';
  exception when insufficient_privilege then null;
  end;

  -- T5. Vendedor nao enxerga nem escreve em nenhuma das duas tabelas novas
  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    select count(*) into v_n from public.etiqueta_modelos;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T5]: vendedor enxergou % modelo(s) (deveria ser 0)', v_n; end if;
    select count(*) into v_n from public.etiqueta_impressoes;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T5]: vendedor enxergou % impressao(oes) no historico (deveria ser 0)', v_n; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T5 pulado: nenhum profile com papel vendedor encontrado.';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T5 (um modelo padrao por operacao, fila nova com zpl pronto, check antigo preservado, historico so-leitura pro app, isolamento de papel).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop table if exists public.etiqueta_impressoes cascade;
  alter table public.solicitacoes_etiqueta
    drop constraint if exists solicitacoes_etiqueta_zpl_ou_campos_antigos,
    drop column if exists zpl,
    drop column if exists modelo_id;
  drop table if exists public.etiqueta_modelos cascade;
  -- linha1/preco/codigo voltam a NOT NULL -- qualquer linha gravada so com zpl (colunas antigas
  -- nulas, seja do $teste$ deste ensaio ou de uso real em producao) e apagada antes, senao o alter
  -- abaixo falha (23502). Rollback desta migration sempre foi destrutivo pras tabelas novas -- isso
  -- so estende a mesma destrutividade pras solicitacoes "novo formato" que sobrariam sem o campo que
  -- o formato antigo exige. Ver aviso no cabecalho do arquivo.
  delete from public.solicitacoes_etiqueta where linha1 is null;
  alter table public.solicitacoes_etiqueta
    alter column linha1 set not null,
    alter column preco set not null,
    alter column codigo set not null;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
declare
  v_dif text;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  create temp table _fp_depois on commit drop as
    select item from (
      select 'TAB ' || t.table_name as item from information_schema.tables t
       where t.table_schema = 'public' and t.table_name in ('etiqueta_modelos', 'etiqueta_impressoes')
      union all
      select 'COL solicitacoes_etiqueta.' || c.column_name || ' nullable=' || c.is_nullable as item
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'solicitacoes_etiqueta'
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

  raise exception 'ENSAIO OK: Modulo Etiquetas Fase A (etiqueta_modelos, etiqueta_impressoes, solicitacoes_etiqueta.zpl/modelo_id, modelo semente "Joia rabicho"), testado (T1 a T5) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
