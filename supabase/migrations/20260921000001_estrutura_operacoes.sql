-- Etapa 1 do modulo de varejo: estrutura de operacoes + carimbo do historico.
-- Decisoes D1 a D7 de 2026-09-21 (ver DECISIONS.md). Modelo:
--   empresa (CNPJ) -> operacao (ATACADO | VAREJO) -> deposito / caixa
--
-- O QUE FAZ (aditivo, uma transacao so):
--   1. Cria empresas, operacoes, depositos, caixas e usuario_operacoes (RLS ligado).
--   2. Semeia 1 empresa, ATACADO (ativa, serie fiscal 1), VAREJO (inativa, sem serie),
--      8 depositos do ATACADO (mesmos UUIDs de locais_estoque) e os vinculos de usuario.
--   3. Adiciona operacao_id em 31 tabelas com ADD COLUMN ... NOT NULL DEFAULT <operacao dona>.
--      Isso carimba o historico SEM UPDATE (nao dispara set_atualizado_em nem Realtime).
--      22 tabelas = ATACADO; 8 tabelas do PDV Eventos = VAREJO (D3); audit_log = coluna
--      nullable e sem default (acoes globais, como criar funcionario, nao tem operacao).
--   4. Cria FKs compostas (coluna, operacao_id) -> pai(id, operacao_id): filho e pai nao
--      conseguem pertencer a operacoes diferentes. Duas excecoes legadas ficam de fora
--      (produtos_evento.produto_origem_id e movimentacoes_estoque_evento.produto_id).
--   5. Registra 5 pendencias em pending_decisions (ativo = false).
--
-- O QUE NAO FAZ (de proposito): RLS por operacao, functions, codigo do app, unicidades por
-- operacao (conceder_permissao usa ON CONFLICT e o upsert de vendedores usa onConflict, os dois
-- dependem das unicidades atuais) e dinheiro em numeric(12,2). Tudo continua funcionando como hoje.
--
-- DEFAULT TRANSITORIO (excecao consciente a regra 1, decisao D5): as functions atuais gravam sem
-- informar operacao_id; o default por tabela (ATACADO, ou VAREJO nas tabelas de evento) mantem
-- tudo funcionando. Guardas: VAREJO nasce inativo; pending_decisions registra a divida; a etapa 2
-- so fecha quando nenhuma coluna operacao_id tiver default (query no fim deste arquivo).
-- Ate a etapa 2 NAO existe isolamento real: o RLS atual continua liberando leitura a qualquer
-- usuario logado. O VAREJO nao pode entrar em operacao antes da etapa 2.
--
-- COMO RODAR (SQL Editor do Supabase):
--   1. ENSAIO (o modo abaixo ja vem como 'ensaio'): aplica, verifica, desfaz pelo rollback e
--      compara o schema com o inicial. Termina de proposito com um erro; sucesso = a mensagem
--      "ENSAIO OK". Nada e gravado.
--   2. APLICAR: trocar 'ensaio' por 'aplicar' na linha do set_config e rodar de novo.
--
-- ROLLBACK:
--   Trocar o modo para 'desfazer' e rodar este mesmo arquivo. Dropa as FKs compostas, as
--   unicidades (id, operacao_id), as colunas operacao_id, as 5 tabelas novas e as 5 linhas de
--   pending_decisions. So remove o que esta migration criou; nenhum dado existente e apagado.
--   Valido enquanto nenhuma etapa posterior (RLS/functions por operacao) estiver aplicada.

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

-- Fonte unica das listas (usada por aplicar, verificar e desfazer) ------------------------

create temp table _op_tabelas (
  tabela text primary key,
  dono text,                      -- 'ATACADO' | 'VAREJO' | null (audit_log)
  obrigatoria boolean not null    -- true = NOT NULL + DEFAULT; false = nullable, sem default
) on commit drop;

insert into _op_tabelas (tabela, dono, obrigatoria) values
  ('pedidos', 'ATACADO', true), ('pedido_itens', 'ATACADO', true),
  ('pedido_pagamentos_mistos', 'ATACADO', true), ('contas_receber', 'ATACADO', true),
  ('contas_pagar', 'ATACADO', true), ('movimentos_estoque', 'ATACADO', true),
  ('notas_fiscais', 'ATACADO', true), ('comissoes_lancamentos', 'ATACADO', true),
  ('crediario_lancamentos', 'ATACADO', true), ('expedicoes', 'ATACADO', true),
  ('abatimentos', 'ATACADO', true), ('garantias', 'ATACADO', true),
  ('solicitacoes_impressao', 'ATACADO', true), ('clientes', 'ATACADO', true),
  ('fornecedores', 'ATACADO', true), ('vendedores', 'ATACADO', true),
  ('permissoes_usuario', 'ATACADO', true), ('condicoes_pagamento', 'ATACADO', true),
  ('faixas_parcelamento', 'ATACADO', true), ('produtos', 'ATACADO', true),
  ('produto_imagens', 'ATACADO', true), ('produto_ia_correcoes', 'ATACADO', true),
  ('vendas_evento', 'VAREJO', true), ('vendas_evento_itens', 'VAREJO', true),
  ('produtos_evento', 'VAREJO', true), ('movimentacoes_estoque_evento', 'VAREJO', true),
  ('movimentos_caixa_evento', 'VAREJO', true), ('aberturas_caixa_evento', 'VAREJO', true),
  ('fechamentos_caixa_evento', 'VAREJO', true), ('cupons_evento', 'VAREJO', true),
  ('audit_log', null, false);

create temp table _op_fks (
  filha text not null,
  coluna text not null,
  pai text not null,
  primary key (filha, coluna)
) on commit drop;

insert into _op_fks (filha, coluna, pai) values
  ('pedido_itens', 'pedido_id', 'pedidos'), ('pedido_itens', 'produto_id', 'produtos'),
  ('pedido_pagamentos_mistos', 'pedido_id', 'pedidos'),
  ('contas_receber', 'pedido_id', 'pedidos'), ('contas_receber', 'cliente_id', 'clientes'),
  ('contas_pagar', 'fornecedor_id', 'fornecedores'),
  ('movimentos_estoque', 'pedido_id', 'pedidos'), ('movimentos_estoque', 'produto_id', 'produtos'),
  ('notas_fiscais', 'pedido_id', 'pedidos'), ('notas_fiscais', 'cliente_id', 'clientes'),
  ('comissoes_lancamentos', 'vendedor_id', 'vendedores'), ('comissoes_lancamentos', 'pedido_id', 'pedidos'),
  ('crediario_lancamentos', 'cliente_id', 'clientes'), ('crediario_lancamentos', 'pedido_id', 'pedidos'),
  ('expedicoes', 'pedido_id', 'pedidos'),
  ('abatimentos', 'pedido_id', 'pedidos'), ('abatimentos', 'cliente_id', 'clientes'),
  ('garantias', 'pedido_id', 'pedidos'), ('garantias', 'produto_id', 'produtos'), ('garantias', 'cliente_id', 'clientes'),
  ('solicitacoes_impressao', 'pedido_id', 'pedidos'),
  ('pedidos', 'cliente_id', 'clientes'),
  ('produtos', 'fornecedor_id', 'fornecedores'),
  ('produto_imagens', 'produto_id', 'produtos'), ('produto_ia_correcoes', 'produto_id', 'produtos'),
  ('vendas_evento_itens', 'venda_id', 'vendas_evento'), ('vendas_evento_itens', 'produto_evento_id', 'produtos_evento'),
  ('movimentacoes_estoque_evento', 'produto_evento_id', 'produtos_evento');

create temp table _op_pendencias (chave text primary key, descricao text not null) on commit drop;

insert into _op_pendencias (chave, descricao) values
  ('serie_fiscal_varejo',
   'Serie fiscal (e tipo de nota) da operacao VAREJO a definir com o contador antes de qualquer emissao do varejo. operacoes.serie_fiscal do VAREJO esta NULL de proposito (D6, 2026-09-21). ATACADO usa a serie 1, a da unica nota existente.'),
  ('remover_default_operacao_id',
   'DEFAULT transitorio de operacao_id (ATACADO, ou VAREJO nas 8 tabelas de evento) criado na etapa 1 para as functions atuais continuarem gravando (D5). Deve ser removido na etapa 2, quando a operacao passar a vir do contexto da sessao (regra 1). Prova: nenhuma coluna operacao_id com column_default no information_schema.'),
  ('unicidades_por_operacao',
   'Unicidades globais (clientes.cpf_cnpj, produtos.codigo_interno, fornecedores.cnpj, condicoes_pagamento.forma_pagamento, faixas_parcelamento, permissoes_usuario(profile_id, permissao), vendedores.profile_id, cupons_evento.codigo) precisam virar por operacao na etapa 2. Nao foram alteradas na etapa 1 porque conceder_permissao (ON CONFLICT) e o upsert de vendedores (onConflict profile_id) dependem das atuais.'),
  ('excecoes_vinculo_evento_atacado',
   'produtos_evento.produto_origem_id e movimentacoes_estoque_evento.produto_id (VAREJO) apontam para produtos do ATACADO sem FK composta (excecao legada da decisao D3). importar_produto_evento e devolver_produto_evento movem estoque do atacado sem lancamento intercompany. A rotina de transferencia entre operacoes deve substituir esses vinculos.'),
  ('dinheiro_numeric_12_2',
   'Regra 6 pede numeric(12,2); o banco usa numeric(10,2) (cerca de 50 colunas em 24 tabelas). Migration propria depois da etapa 1 (D7), incluindo variaveis numeric(10,2) declaradas dentro das functions e docs/architecture/money-handling.md.');

-- Trava as tabelas afetadas (o app nao consegue escrever durante a migration) e guarda as contagens.
create temp table _op_contagens_antes (tabela text primary key, n bigint not null) on commit drop;

do $lock$
declare
  r record;
  v_n bigint;
begin
  for r in select tabela from _op_tabelas order by tabela loop
    execute format('lock table public.%I in access exclusive mode', r.tabela);
  end loop;
  for r in select tabela from _op_tabelas order by tabela loop
    execute format('select count(*) from public.%I', r.tabela) into v_n;
    insert into _op_contagens_antes (tabela, n) values (r.tabela, v_n);
  end loop;
end $lock$;

-- Impressao digital do schema (para provar que o rollback devolve o estado inicial) --------

create or replace function pg_temp.fp_schema() returns table(item text) language sql as $f$
  select 'T ' || c.relname || ' ' || c.relkind::text
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
    from pg_policies where schemaname = 'public'
  union all
  select 'G ' || tgrelid::regclass::text || ' ' || tgname
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'D pending_decisions ' || count(*) from public.pending_decisions
$f$;

create temp table _fp_antes on commit drop as select item from pg_temp.fp_schema();

-- APLICAR (modos ensaio e aplicar) -------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_empresa uuid;
  v_atacado uuid;
  v_varejo uuid;
  v_op uuid;
  r record;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regclass('public.operacoes') is not null then
    raise exception 'ABORTADO: public.operacoes ja existe; esta migration parece ja aplicada.';
  end if;

  -- 1. Estrutura nova ------------------------------------------------------------------

  create table public.empresas (
    id uuid primary key default gen_random_uuid(),
    razao_social text not null,
    nome_fantasia text,
    cnpj text not null,
    inscricao_estadual text,
    crt text,
    logradouro text,
    numero text,
    bairro text,
    cidade text,
    uf text,
    cep text,
    codigo_ibge_cidade text,
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint empresas_cnpj_formato check (cnpj ~ '^[0-9]{14}$'),
    constraint empresas_cnpj_key unique (cnpj)
  );

  create table public.operacoes (
    id uuid primary key default gen_random_uuid(),
    empresa_id uuid not null references public.empresas (id),
    codigo text not null,
    nome text not null,
    serie_fiscal text,
    ativo boolean not null default false,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint operacoes_codigo_formato check (codigo ~ '^[A-Z][A-Z0-9_]*$'),
    constraint operacoes_empresa_codigo_key unique (empresa_id, codigo)
  );

  create table public.depositos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    nome text not null,
    tipo text not null,
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint depositos_operacao_nome_key unique (operacao_id, nome),
    constraint depositos_id_operacao_key unique (id, operacao_id)
  );

  create table public.caixas (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    nome text not null,
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint caixas_operacao_nome_key unique (operacao_id, nome),
    constraint caixas_id_operacao_key unique (id, operacao_id)
  );

  create table public.usuario_operacoes (
    profile_id uuid not null references public.profiles (id) on delete cascade,
    operacao_id uuid not null references public.operacoes (id),
    concedida_por uuid references public.profiles (id),
    concedida_em timestamptz not null default now(),
    primary key (profile_id, operacao_id)
  );

  comment on table public.empresas is 'Empresas (CNPJ) do grupo. Uma empresa tem varias operacoes.';
  comment on table public.operacoes is 'Operacoes de uma empresa (ATACADO, VAREJO...). Cada uma tem faturamento, caixa, financeiro e serie fiscal proprios.';
  comment on table public.depositos is 'Depositos de estoque de uma operacao. Semeado a partir de locais_estoque (mesmos UUIDs) para o ATACADO.';
  comment on table public.caixas is 'Caixas (PDV) de uma operacao.';
  comment on table public.usuario_operacoes is 'Quais operacoes cada usuario pode acessar. Base do contexto de sessao da etapa 2.';

  create trigger empresas_atualizado_em before update on public.empresas for each row execute function public.set_atualizado_em();
  create trigger operacoes_atualizado_em before update on public.operacoes for each row execute function public.set_atualizado_em();
  create trigger depositos_atualizado_em before update on public.depositos for each row execute function public.set_atualizado_em();
  create trigger caixas_atualizado_em before update on public.caixas for each row execute function public.set_atualizado_em();

  -- RLS: negado por padrao; admin gerencia; usuario le so o que esta vinculado a ele.
  alter table public.empresas enable row level security;
  alter table public.operacoes enable row level security;
  alter table public.depositos enable row level security;
  alter table public.caixas enable row level security;
  alter table public.usuario_operacoes enable row level security;

  create policy "admin gerencia empresas" on public.empresas for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario)
    with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "usuario le empresas das suas operacoes" on public.empresas for select to authenticated
    using (exists (select 1 from public.operacoes o
                   join public.usuario_operacoes uo on uo.operacao_id = o.id
                   where o.empresa_id = empresas.id and uo.profile_id = auth.uid()));

  create policy "admin gerencia operacoes" on public.operacoes for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario)
    with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "usuario le suas operacoes" on public.operacoes for select to authenticated
    using (exists (select 1 from public.usuario_operacoes uo
                   where uo.operacao_id = operacoes.id and uo.profile_id = auth.uid()));

  create policy "admin gerencia depositos" on public.depositos for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario)
    with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "usuario le depositos das suas operacoes" on public.depositos for select to authenticated
    using (exists (select 1 from public.usuario_operacoes uo
                   where uo.operacao_id = depositos.operacao_id and uo.profile_id = auth.uid()));

  create policy "admin gerencia caixas" on public.caixas for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario)
    with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "usuario le caixas das suas operacoes" on public.caixas for select to authenticated
    using (exists (select 1 from public.usuario_operacoes uo
                   where uo.operacao_id = caixas.operacao_id and uo.profile_id = auth.uid()));

  create policy "admin gerencia usuario_operacoes" on public.usuario_operacoes for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario)
    with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "usuario le os proprios vinculos" on public.usuario_operacoes for select to authenticated
    using (profile_id = auth.uid());

  revoke all on public.empresas, public.operacoes, public.depositos, public.caixas, public.usuario_operacoes from anon;
  grant select, insert, update, delete on public.empresas, public.operacoes, public.depositos, public.caixas, public.usuario_operacoes to authenticated;
  grant all on public.empresas, public.operacoes, public.depositos, public.caixas, public.usuario_operacoes to service_role;

  -- 2. Sementes -----------------------------------------------------------------------

  insert into public.empresas (razao_social, nome_fantasia, cnpj, inscricao_estadual, crt,
                               logradouro, numero, bairro, cidade, uf, cep, codigo_ibge_cidade)
  values ('JOSE LIBERIO DA SILVA', 'TROLESI JOIAS', '41832775000100', '3247950740033', '1',
          'RUA BALDUINO SALGADO', '53', 'SAO VICENTE', 'ITAJUBA', 'MG', '37502084', '3132404')
  returning id into v_empresa;

  insert into public.operacoes (empresa_id, codigo, nome, serie_fiscal, ativo)
  values (v_empresa, 'ATACADO', 'ATACADO', '1', true)
  returning id into v_atacado;

  insert into public.operacoes (empresa_id, codigo, nome, serie_fiscal, ativo)
  values (v_empresa, 'VAREJO', 'VAREJO', null, false)
  returning id into v_varejo;

  insert into public.depositos (id, operacao_id, nome, tipo, ativo, criado_em)
  select l.id, v_atacado, l.nome, l.tipo, l.ativo, l.criado_em from public.locais_estoque l;

  -- D4: Lucas (admin) em ATACADO e VAREJO; Barbara, Bianca e Maria Fernanda so em ATACADO;
  -- TESTE TESTE sem nenhuma operacao.
  insert into public.usuario_operacoes (profile_id, operacao_id, concedida_por) values
    ('5140c5d4-1cd9-4538-84c3-623b8266c4b2', v_atacado, '5140c5d4-1cd9-4538-84c3-623b8266c4b2'),
    ('5140c5d4-1cd9-4538-84c3-623b8266c4b2', v_varejo,  '5140c5d4-1cd9-4538-84c3-623b8266c4b2'),
    ('c68a61de-5fd0-4191-bf88-a64eff0b7964', v_atacado, '5140c5d4-1cd9-4538-84c3-623b8266c4b2'),
    ('37f69035-2bdd-46f0-b7fa-75910cdd3738', v_atacado, '5140c5d4-1cd9-4538-84c3-623b8266c4b2'),
    ('bb139caf-3270-48aa-9eae-7e04bd94cd10', v_atacado, '5140c5d4-1cd9-4538-84c3-623b8266c4b2');

  -- 3. Carimbo: operacao_id nas 31 tabelas ---------------------------------------------

  for r in select tabela, dono, obrigatoria from _op_tabelas order by tabela loop
    v_op := case r.dono when 'ATACADO' then v_atacado when 'VAREJO' then v_varejo end;
    if r.obrigatoria then
      execute format('alter table public.%I add column operacao_id uuid not null default %L', r.tabela, v_op);
    else
      execute format('alter table public.%I add column operacao_id uuid', r.tabela);
    end if;
    execute format('alter table public.%I add constraint %I foreign key (operacao_id) references public.operacoes (id)',
                   r.tabela, r.tabela || '_operacao_id_fkey');
    execute format('create index %I on public.%I (operacao_id)', r.tabela || '_operacao_id_idx', r.tabela);
  end loop;

  -- 4. FKs compostas: filho e pai na mesma operacao ------------------------------------

  for r in select distinct pai from _op_fks order by pai loop
    execute format('alter table public.%I add constraint %I unique (id, operacao_id)',
                   r.pai, r.pai || '_id_operacao_id_key');
  end loop;

  for r in select filha, coluna, pai from _op_fks order by filha, coluna loop
    execute format('alter table public.%I add constraint %I foreign key (%I, operacao_id) references public.%I (id, operacao_id)',
                   r.filha, r.filha || '_' || r.coluna || '_op_fkey', r.coluna, r.pai);
  end loop;

  -- 5. Pendencias ----------------------------------------------------------------------

  insert into public.pending_decisions (chave, descricao, ativo)
  select chave, descricao, false from _op_pendencias;
end $up$;

-- VERIFICAR (modos ensaio e aplicar): qualquer falha aborta a transacao inteira -------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  r record;
  v_atacado uuid;
  v_varejo uuid;
  v_op uuid;
  v_n bigint;
  v_m bigint;
  v_antes bigint;
  v_fora bigint;
  v_def text;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  for r in select tabela, dono, obrigatoria from _op_tabelas order by tabela loop
    perform 1 from information_schema.columns
     where table_schema = 'public' and table_name = r.tabela and column_name = 'operacao_id'
       and is_nullable = case when r.obrigatoria then 'NO' else 'YES' end;
    if not found then
      raise exception 'FALHA: %.operacao_id ausente ou com nulabilidade errada', r.tabela;
    end if;

    execute format('select count(*) from public.%I', r.tabela) into v_n;
    select n into v_antes from _op_contagens_antes where tabela = r.tabela;
    if v_n is distinct from v_antes then
      raise exception 'FALHA: contagem de % mudou (% para %)', r.tabela, v_antes, v_n;
    end if;

    select column_default into v_def from information_schema.columns
     where table_schema = 'public' and table_name = r.tabela and column_name = 'operacao_id';

    if r.obrigatoria then
      v_op := case r.dono when 'ATACADO' then v_atacado else v_varejo end;
      execute format('select count(*) from public.%I where operacao_id is distinct from %L', r.tabela, v_op) into v_fora;
      if v_fora <> 0 then
        raise exception 'FALHA: % linhas de % fora da operacao dona (%)', v_fora, r.tabela, r.dono;
      end if;
      if v_def is null or position(v_op::text in v_def) = 0 then
        raise exception 'FALHA: default de %.operacao_id incorreto (%)', r.tabela, v_def;
      end if;
    elsif v_def is not null then
      raise exception 'FALHA: %.operacao_id nao deveria ter default (%)', r.tabela, v_def;
    end if;
  end loop;

  select count(*) into v_n from pg_constraint
   where connamespace = 'public'::regnamespace and contype = 'f' and right(conname, 8) = '_op_fkey' and convalidated;
  select count(*) into v_m from _op_fks;
  if v_n <> v_m then
    raise exception 'FALHA: FKs compostas validadas = %, esperado %', v_n, v_m;
  end if;

  select count(*) into v_n from public.operacoes;
  if v_n <> 2 then raise exception 'FALHA: operacoes = %, esperado 2', v_n; end if;
  perform 1 from public.operacoes where codigo = 'ATACADO' and ativo and serie_fiscal = '1';
  if not found then raise exception 'FALHA: ATACADO deve estar ativa com serie 1'; end if;
  perform 1 from public.operacoes where codigo = 'VAREJO' and not ativo and serie_fiscal is null;
  if not found then raise exception 'FALHA: VAREJO deve estar inativa e sem serie'; end if;

  select count(*) into v_n from public.depositos;
  select count(*) into v_m from public.locais_estoque;
  if v_n <> v_m then raise exception 'FALHA: depositos = %, locais_estoque = %', v_n, v_m; end if;

  select count(*) into v_n from public.usuario_operacoes;
  if v_n <> 5 then raise exception 'FALHA: usuario_operacoes = %, esperado 5', v_n; end if;

  select count(*) into v_n from public.pending_decisions where chave in (select chave from _op_pendencias);
  select count(*) into v_m from _op_pendencias;
  if v_n <> v_m then raise exception 'FALHA: pendencias registradas = %, esperado %', v_n, v_m; end if;

  select count(*) into v_n from public.produtos_evento where produto_origem_id is not null;
  raise notice 'Excecao legada (D3): % linhas de produtos_evento com produto_origem_id apontando para produtos do ATACADO.', v_n;
  raise notice 'VERIFICACAO OK: 31 tabelas carimbadas, contagens preservadas, 28 FKs compostas, sementes conferidas.';
end $chk$;

-- DESFAZER (modos ensaio e desfazer) ---------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  r record;
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  for r in select filha, coluna from _op_fks order by filha, coluna loop
    execute format('alter table public.%I drop constraint if exists %I', r.filha, r.filha || '_' || r.coluna || '_op_fkey');
  end loop;

  for r in select distinct pai from _op_fks order by pai loop
    execute format('alter table public.%I drop constraint if exists %I', r.pai, r.pai || '_id_operacao_id_key');
  end loop;

  -- Dropar a coluna leva junto o default, o indice e a FK para operacoes.
  for r in select tabela from _op_tabelas order by tabela loop
    execute format('alter table public.%I drop column if exists operacao_id', r.tabela);
  end loop;

  drop table if exists public.usuario_operacoes, public.caixas, public.depositos, public.operacoes, public.empresas;

  delete from public.pending_decisions where chave in (select chave from _op_pendencias);
end $down$;

-- COMPARAR (so ensaio): o rollback tem de devolver o schema ao estado inicial ---------------

do $cmp$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_dif text;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  create temp table _fp_depois on commit drop as select item from pg_temp.fp_schema();

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: migration aplicada, verificada e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
drop function if exists pg_temp.fp_schema();
notify pgrst, 'reload schema';

commit;

-- VERIFICACAO POS-APLICACAO (rodar depois de aplicar; todas so leem):
--   -- 31 tabelas com operacao_id (30 NOT NULL + audit_log nullable):
--   select count(*) filter (where is_nullable = 'NO') as obrigatorias, count(*) as total
--     from information_schema.columns where table_schema = 'public' and column_name = 'operacao_id';
--   -- distribuicao por operacao (ATACADO deve ter tudo, exceto as 8 tabelas de evento):
--   select o.codigo, count(*) as pedidos from public.pedidos p join public.operacoes o on o.id = p.operacao_id group by 1;
--   select o.codigo, count(*) as vendas_evento from public.vendas_evento v join public.operacoes o on o.id = v.operacao_id group by 1;
--   -- defaults transitorios que a etapa 2 precisa remover (deve listar 30 linhas agora e 0 na etapa 2):
--   select table_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'operacao_id' and column_default is not null order by 1;
