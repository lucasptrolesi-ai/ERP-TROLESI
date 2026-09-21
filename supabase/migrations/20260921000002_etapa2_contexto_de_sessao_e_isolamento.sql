-- Etapa 2 do modulo de varejo: contexto de sessao + isolamento por operacao.
-- Pre-requisito: etapa 1 aplicada (20260921000001). Decisoes: ver DECISIONS.md.
--
-- O QUE FAZ (uma transacao so):
--   1. operacao_atual(): a operacao da sessao, lida do JWT do usuario (app_metadata.operacao_id) e
--      SEMPRE validada contra usuario_operacoes. Claim invalido/forjado cai na operacao padrao do
--      usuario. Sem vinculo => NULL => o usuario nao ve nem grava nada (falha fechada).
--   2. usuario_operacoes.padrao: a operacao usada quando nao ha claim (Lucas, Barbara, Bianca e
--      Maria Fernanda ficam com ATACADO, entao o app atual continua igual).
--   3. Politica RESTRITIVA "escopo de operacao" nas 31 tabelas: soma-se (AND) as politicas de papel
--      que ja existem. Cobre leitura, escrita e Realtime. audit_log enxerga tambem as linhas globais.
--   4. Triggers em 30 tabelas: operacao_id e carimbado pela sessao; INSERT com operacao_id informado
--      e rejeitado (42501); UPDATE de operacao_id e rejeitado. So a rotina de transferencia (etapa 5)
--      pode liberar isso, via app.transferencia. Os DEFAULT transitorios da etapa 1 sao removidos.
--   5. Guardas nas functions SECURITY DEFINER (que ignoram RLS): exigem a operacao certa e que o
--      registro pedido pertenca a operacao atual. Modulo de atacado = ATACADO; PDV Eventos = VAREJO.
--      tem_permissao passa a valer por operacao. As guardas sao inseridas em runtime sobre a
--      definicao viva de cada function e o rollback remove exatamente o que foi inserido.
--   6. Bucket pedidos-notas-fotos restrito ao ATACADO. contexto_sessao(): 1 chamada para o app.
--
-- EFEITO NO USO ATUAL: atacado igual a hoje. PDV Eventos (dados VAREJO) so funciona em contexto
-- VAREJO (seletor de operacao, app da etapa 2C); ate la ele fica vazio para todos, inclusive admin.
-- TESTE TESTE, sem operacao, deixa de ver qualquer dado (falha fechada, de proposito).
--
-- COMO RODAR (SQL Editor do Supabase), igual a etapa 1:
--   1. ENSAIO (modo padrao abaixo): aplica, verifica, RODA TESTES DE COMPORTAMENTO simulando cada
--      usuario real (Lucas, Barbara, TESTE TESTE, anon; claim valido e forjado), desfaz e compara o
--      schema com o inicial. Termina de proposito com erro; sucesso = "ENSAIO OK". Nada e gravado.
--   2. APLICAR: trocar 'ensaio' por 'aplicar' e rodar. Erro 42P01 sobre _op_* depois do commit e o
--      ruido inofensivo do SQL Editor (ver etapa 1).
--   3. ROLLBACK: modo 'desfazer' no mesmo arquivo.

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

-- Fonte unica das listas ---------------------------------------------------------------------

create temp table _op_tabelas (
  tabela text primary key,
  dono text,
  obrigatoria boolean not null
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

-- Guardas inseridas logo depois do "begin" de cada function (reversiveis: o bloco e removido por replace).
create temp table _op_guardas (funcao text primary key, bloco text not null) on commit drop;

insert into _op_guardas (funcao, bloco) values
  ('criar_pedido', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''clientes'', p_cliente_id);\n'),
  ('extornar_pedido', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''pedidos'', p_pedido_id);\n'),
  ('criar_expedicao', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''pedidos'', p_pedido_id);\n'),
  ('lancar_crediario', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''clientes'', p_cliente_id);\n  perform public.exigir_operacao(''pedidos'', p_pedido_id);\n'),
  ('receber_crediario', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''crediario_lancamentos'', p_id);\n'),
  ('converter_cliente_em_crediario', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''clientes'', p_cliente_id);\n'),
  ('aprovar_abatimento', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''abatimentos'', p_id);\n'),
  ('reprovar_abatimento', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''abatimentos'', p_id);\n'),
  ('aprovar_reprovar_garantia', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n  perform public.exigir_operacao(''garantias'', p_id);\n'),
  ('importar_pedidos_gmax', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''ATACADO'');\n'),
  ('registrar_visualizacao_ficha_cliente', E'  -- [op-guard]\n  perform public.exigir_operacao(''clientes'', p_cliente_id);\n'),
  ('criar_venda_evento', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''VAREJO'');\n'),
  ('extornar_venda_evento', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''VAREJO'');\n  perform public.exigir_operacao(''vendas_evento'', p_venda_id);\n'),
  ('importar_produto_evento', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''VAREJO'');\n'),
  ('devolver_produto_evento', E'  -- [op-guard]\n  perform public.exigir_operacao_codigo(''VAREJO'');\n  perform public.exigir_operacao(''produtos_evento'', p_produto_evento_id);\n');

create temp table _op2_pendencias (chave text primary key, descricao text not null) on commit drop;

insert into _op2_pendencias (chave, descricao) values
  ('estoque_saldo_por_movimento',
   'Regra 3: produtos.quantidade_estoque e coluna mutavel e diverge da soma de movimentos_estoque em 32 de 50 produtos (18 sem movimento). Etapa 3 cria saldo inicial por movimento, custo_unitario congelado e remove a coluna mutavel.'),
  ('auditoria_ip_operacao',
   'audit_log ainda nao registra IP (a operacao ja vem do contexto). Exige repassar o IP do usuario final do servidor Next ao banco de forma confiavel; tratar na etapa de auditoria/caixa.'),
  ('storage_notinhas_por_operacao',
   'Bucket pedidos-notas-fotos foi restrito ao contexto ATACADO na etapa 2. Prefixo de pasta por operacao fica para quando o varejo tiver anexos.'),
  ('pdv_eventos_exige_varejo',
   'As functions do PDV Eventos exigem contexto VAREJO. Usuario precisa trocar de operacao (seletor da etapa 2C); somente o admin tem VAREJO hoje (D4).'),
  ('functions_definer_sem_guarda',
   'Sem guarda de operacao na etapa 2: pedido_tem_registro_financeiro (language sql; oraculo booleano por id), conceder_permissao e revogar_permissao (revogar remove a permissao em todas as operacoes), informar_cotacao (global). Revisar na etapa de auditoria.');

-- Trava as tabelas e guarda as contagens ---------------------------------------------------------

create temp table _op_contagens_antes (tabela text primary key, n bigint not null) on commit drop;

do $lock$
declare
  r record;
  v_n bigint;
begin
  for r in select tabela from _op_tabelas order by tabela loop
    execute format('lock table public.%I in access exclusive mode', r.tabela);
  end loop;
  lock table public.usuario_operacoes in access exclusive mode;
  for r in select tabela from _op_tabelas order by tabela loop
    execute format('select count(*) from public.%I', r.tabela) into v_n;
    insert into _op_contagens_antes (tabela, n) values (r.tabela, v_n);
  end loop;
end $lock$;

-- Impressao digital do schema ------------------------------------------------------------------

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
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'G ' || tgrelid::regclass::text || ' ' || tgname
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'D pending_decisions ' || count(*) || ' ' || count(*) filter (where ativo) from public.pending_decisions
$f$;

create temp table _fp_antes on commit drop as select item from pg_temp.fp_schema();

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_def text;
  v_novo text;
  r record;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.operacao_atual()') is not null then
    raise exception 'ABORTADO: public.operacao_atual() ja existe; a etapa 2 parece ja aplicada.';
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  if v_atacado is null or v_varejo is null then
    raise exception 'ABORTADO: operacoes ATACADO/VAREJO ausentes (etapa 1 nao aplicada?).';
  end if;

  -- 1. Operacao padrao por usuario -------------------------------------------------------------
  alter table public.usuario_operacoes add column padrao boolean not null default false;
  update public.usuario_operacoes set padrao = true where operacao_id = v_atacado;
  create unique index usuario_operacoes_padrao_key on public.usuario_operacoes (profile_id) where padrao;

  -- 2. Funcoes do contexto -----------------------------------------------------------------------

  create or replace function public.operacao_atual() returns uuid
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_servico text := nullif(current_setting('app.operacao_servico', true), '');
    v_uid uuid := auth.uid();
    v_claim uuid;
    v_op uuid;
  begin
    if v_servico is not null then
      return v_servico::uuid;
    end if;
    if v_uid is null then
      return null;
    end if;

    begin
      v_claim := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'operacao_id', '')::uuid;
    exception when others then
      v_claim := null;
    end;

    if v_claim is not null then
      select uo.operacao_id into v_op
        from public.usuario_operacoes uo
        join public.operacoes o on o.id = uo.operacao_id
        join public.profiles p on p.id = uo.profile_id
       where uo.profile_id = v_uid and uo.operacao_id = v_claim and p.ativo
         and (o.ativo or p.papel = 'admin');
      if v_op is not null then
        return v_op;
      end if;
    end if;

    select s.operacao_id into v_op
      from (select uo.operacao_id, uo.padrao, count(*) over () as n
              from public.usuario_operacoes uo
              join public.operacoes o on o.id = uo.operacao_id
              join public.profiles p on p.id = uo.profile_id
             where uo.profile_id = v_uid and o.ativo and p.ativo) s
     where s.padrao or s.n = 1
     order by s.padrao desc
     limit 1;
    return v_op;
  end
  $fn$;

  create or replace function public.exigir_operacao(p_tabela text, p_id uuid) returns void
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_atual uuid := public.operacao_atual();
    v_op uuid;
  begin
    if p_id is null then
      return;
    end if;
    if v_atual is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    if p_tabela not in ('pedidos', 'clientes', 'abatimentos', 'garantias', 'crediario_lancamentos',
                        'vendas_evento', 'produtos_evento', 'produtos', 'fornecedores') then
      raise exception 'exigir_operacao: tabela nao permitida (%)', p_tabela;
    end if;
    execute format('select operacao_id from public.%I where id = $1', p_tabela) into v_op using p_id;
    if v_op is distinct from v_atual then
      raise exception 'Registro nao encontrado na operacao atual' using errcode = '42501';
    end if;
  end
  $fn$;

  create or replace function public.exigir_operacao_codigo(p_codigo text) returns void
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_cod text;
  begin
    select o.codigo into v_cod from public.operacoes o where o.id = public.operacao_atual();
    if v_cod is distinct from p_codigo then
      raise exception 'Esta acao so e permitida na operacao %', p_codigo using errcode = '42501';
    end if;
  end
  $fn$;

  create or replace function public.contexto_sessao() returns jsonb
  language sql stable security definer set search_path = public as $fn$
    select jsonb_build_object(
      'usuario_id', auth.uid(),
      'papel', (select p.papel from public.profiles p where p.id = auth.uid()),
      'operacao_id', public.operacao_atual(),
      'operacao_codigo', (select o.codigo from public.operacoes o where o.id = public.operacao_atual()),
      'operacoes', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome,
                                                                 'ativa', o.ativo, 'padrao', uo.padrao) order by o.codigo)
                               from public.usuario_operacoes uo
                               join public.operacoes o on o.id = uo.operacao_id
                              where uo.profile_id = auth.uid()), '[]'::jsonb),
      'permissoes', coalesce((select jsonb_agg(pu.permissao order by pu.permissao)
                                from public.permissoes_usuario pu
                               where pu.profile_id = auth.uid() and pu.operacao_id = public.operacao_atual()), '[]'::jsonb)
    )
  $fn$;

  create or replace function public.carimbar_operacao() returns trigger
  language plpgsql as $fn$
  declare
    v_atual uuid;
  begin
    if new.operacao_id is not null and coalesce(current_setting('app.transferencia', true), '') <> 'on' then
      raise exception 'operacao_id nao pode ser informado: ele vem do contexto da sessao' using errcode = '42501';
    end if;
    if new.operacao_id is null then
      v_atual := public.operacao_atual();
      if v_atual is null then
        raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
      end if;
      new.operacao_id := v_atual;
    end if;
    return new;
  end
  $fn$;

  create or replace function public.travar_operacao() returns trigger
  language plpgsql as $fn$
  begin
    if new.operacao_id is distinct from old.operacao_id and coalesce(current_setting('app.transferencia', true), '') <> 'on' then
      raise exception 'operacao_id nao pode ser alterado' using errcode = '42501';
    end if;
    return new;
  end
  $fn$;

  create or replace function public.carimbar_operacao_auditoria() returns trigger
  language plpgsql as $fn$
  begin
    if new.operacao_id is null then
      new.operacao_id := public.operacao_atual();
    end if;
    return new;
  end
  $fn$;

  revoke execute on function public.exigir_operacao(text, uuid), public.exigir_operacao_codigo(text), public.contexto_sessao() from public, anon, authenticated;
  grant execute on function public.contexto_sessao() to authenticated;

  -- 3. Triggers, sem default, politica restritiva ------------------------------------------------

  for r in select tabela, obrigatoria from _op_tabelas order by tabela loop
    if r.obrigatoria then
      execute format('alter table public.%I alter column operacao_id drop default', r.tabela);
      execute format('create trigger trg_carimbar_operacao before insert on public.%I for each row execute function public.carimbar_operacao()', r.tabela);
      execute format('create trigger trg_travar_operacao before update of operacao_id on public.%I for each row execute function public.travar_operacao()', r.tabela);
      execute format($p$create policy "escopo de operacao" on public.%I as restrictive for all to public using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()))$p$, r.tabela);
    else
      execute format('create trigger trg_carimbar_operacao_auditoria before insert on public.%I for each row execute function public.carimbar_operacao_auditoria()', r.tabela);
      execute format($p$create policy "escopo de operacao" on public.%I as restrictive for all to public using (operacao_id is null or operacao_id = (select public.operacao_atual())) with check (operacao_id is null or operacao_id = (select public.operacao_atual()))$p$, r.tabela);
    end if;
  end loop;

  -- 4. Guardas nas functions SECURITY DEFINER ---------------------------------------------------

  for r in select funcao, bloco from _op_guardas order by funcao loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.funcao;
    if v_def is null then
      raise exception 'ABORTADO: function % nao encontrada', r.funcao;
    end if;
    if position('[op-guard]' in v_def) > 0 then
      raise exception 'ABORTADO: function % ja tem guarda', r.funcao;
    end if;
    v_novo := regexp_replace(v_def, E'(^|\n)begin\n', E'\\1begin\n' || r.bloco);
    if v_novo = v_def then
      raise exception 'ABORTADO: begin de % nao localizado', r.funcao;
    end if;
    execute v_novo;
  end loop;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tem_permissao';
  v_novo := regexp_replace(v_def, '(and\s+permissao\s*=\s*p_permissao)', '\1 and operacao_id = public.operacao_atual()');
  if v_novo = v_def then
    raise exception 'ABORTADO: predicado de tem_permissao nao localizado';
  end if;
  execute v_novo;

  -- 5. Storage: notinhas de pedido so no contexto ATACADO -------------------------------------------

  create policy "escopo de operacao notinhas" on storage.objects as restrictive for all to authenticated
    using (bucket_id <> 'pedidos-notas-fotos'
           or exists (select 1 from public.operacoes o where o.id = (select public.operacao_atual()) and o.codigo = 'ATACADO'))
    with check (bucket_id <> 'pedidos-notas-fotos'
           or exists (select 1 from public.operacoes o where o.id = (select public.operacao_atual()) and o.codigo = 'ATACADO'));

  -- 6. Pendencias --------------------------------------------------------------------------------

  insert into public.pending_decisions (chave, descricao, ativo)
  select chave, descricao, false from _op2_pendencias;

  update public.pending_decisions
     set ativo = true, decidido_em = now(), decidido_por = '5140c5d4-1cd9-4538-84c3-623b8266c4b2',
         decisao = 'Etapa 2: DEFAULT removido das 30 colunas operacao_id; a operacao passa a vir do contexto da sessao (trigger trg_carimbar_operacao).'
   where chave = 'remover_default_operacao_id';
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  r record;
  v_n bigint;
  v_m bigint;
  v_antes bigint;
  v_src text;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  for r in select tabela from _op_tabelas order by tabela loop
    execute format('select count(*) from public.%I', r.tabela) into v_n;
    select n into v_antes from _op_contagens_antes where tabela = r.tabela;
    if v_n is distinct from v_antes then
      raise exception 'FALHA: contagem de % mudou (% para %)', r.tabela, v_antes, v_n;
    end if;
  end loop;

  select count(*) into v_n from pg_policies where schemaname = 'public' and policyname = 'escopo de operacao' and permissive = 'RESTRICTIVE';
  if v_n <> 31 then raise exception 'FALHA: politicas restritivas = %, esperado 31', v_n; end if;

  select count(*) into v_n from pg_trigger where not tgisinternal and tgname = 'trg_carimbar_operacao';
  if v_n <> 30 then raise exception 'FALHA: triggers de carimbo = %, esperado 30', v_n; end if;
  select count(*) into v_n from pg_trigger where not tgisinternal and tgname = 'trg_travar_operacao';
  if v_n <> 30 then raise exception 'FALHA: triggers de trava = %, esperado 30', v_n; end if;
  select count(*) into v_n from pg_trigger where not tgisinternal and tgname = 'trg_carimbar_operacao_auditoria';
  if v_n <> 1 then raise exception 'FALHA: trigger de auditoria = %, esperado 1', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'operacao_id' and column_default is not null
     and table_name in (select tabela from _op_tabelas);
  if v_n <> 0 then raise exception 'FALHA: ainda ha % colunas operacao_id com DEFAULT', v_n; end if;

  select count(*) into v_n from _op_guardas;
  select count(*) into v_m from pg_proc p join _op_guardas g on g.funcao = p.proname
   where p.pronamespace = 'public'::regnamespace and position('[op-guard]' in p.prosrc) > 0;
  if v_n <> v_m then raise exception 'FALHA: functions com guarda = %, esperado %', v_m, v_n; end if;

  select prosrc into v_src from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tem_permissao';
  if position('operacao_atual' in v_src) = 0 then raise exception 'FALHA: tem_permissao nao ficou por operacao'; end if;

  select count(*) into v_n from public.usuario_operacoes where padrao;
  if v_n <> 4 then raise exception 'FALHA: usuarios com operacao padrao = %, esperado 4', v_n; end if;

  select count(*) into v_n from pg_policies where schemaname = 'storage' and policyname = 'escopo de operacao notinhas';
  if v_n <> 1 then raise exception 'FALHA: politica do bucket de notinhas ausente'; end if;

  select count(*) into v_n from public.pending_decisions where chave in (select chave from _op2_pendencias);
  select count(*) into v_m from _op2_pendencias;
  if v_n <> v_m then raise exception 'FALHA: pendencias = %, esperado %', v_n, v_m; end if;

  raise notice 'VERIFICACAO OK: 31 politicas restritivas, 30+30+1 triggers, 0 defaults, % functions com guarda.', (select count(*) from _op_guardas);
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio): simula cada usuario real -------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_teste uuid := '87ed5652-e4bd-4b8b-8ea0-e45dd5cb3753';
  v_esp_a jsonb := '{}'::jsonb;
  v_esp_v jsonb := '{}'::jsonb;
  v_n bigint;
  v_op uuid;
  v_venda uuid;
  v_pedido uuid;
  v_perm text;
  v_ea_perm bigint;
  v_ok boolean;
  v_ctx jsonb;
  k text;
  r record;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  -- Esperado, medido como dono (sem RLS)
  for r in select tabela from _op_tabelas where obrigatoria order by tabela loop
    execute format('select count(*) from public.%I where operacao_id = %L', r.tabela, v_atacado) into v_n;
    v_esp_a := v_esp_a || jsonb_build_object(r.tabela, v_n);
    execute format('select count(*) from public.%I where operacao_id = %L', r.tabela, v_varejo) into v_n;
    v_esp_v := v_esp_v || jsonb_build_object(r.tabela, v_n);
  end loop;
  select id into v_venda from public.vendas_evento limit 1;
  select id into v_pedido from public.pedidos limit 1;
  select permissao::text into v_perm from public.permissoes_usuario where profile_id = v_barbara limit 1;
  select count(*) into v_ea_perm from public.permissoes_usuario where profile_id = v_barbara;

  -- T1. Lucas (admin) sem claim: contexto ATACADO, ve tudo do ATACADO e nada do VAREJO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_op := public.operacao_atual();
  if v_op is distinct from v_atacado then raise exception 'TESTE FALHOU [T1 Lucas sem claim]: operacao_atual = %, esperado ATACADO', v_op; end if;
  for k in select jsonb_object_keys(v_esp_a) loop
    execute format('select count(*) from public.%I', k) into v_n;
    if v_n <> (v_esp_a ->> k)::bigint then
      raise exception 'TESTE FALHOU [T1 Lucas ATACADO]: % = %, esperado %', k, v_n, v_esp_a ->> k;
    end if;
  end loop;
  v_ctx := public.contexto_sessao();
  if (v_ctx ->> 'operacao_id') is distinct from v_atacado::text or jsonb_array_length(v_ctx -> 'operacoes') <> 2 then
    raise exception 'TESTE FALHOU [T1 contexto_sessao]: %', v_ctx;
  end if;
  execute 'reset role';

  -- T2. Lucas com claim VAREJO (admin pode usar operacao inativa): ve o VAREJO e nada do ATACADO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  v_op := public.operacao_atual();
  if v_op is distinct from v_varejo then raise exception 'TESTE FALHOU [T2 Lucas VAREJO]: operacao_atual = %, esperado VAREJO', v_op; end if;
  for k in select jsonb_object_keys(v_esp_v) loop
    execute format('select count(*) from public.%I', k) into v_n;
    if v_n <> (v_esp_v ->> k)::bigint then
      raise exception 'TESTE FALHOU [T2 Lucas VAREJO]: % = %, esperado %', k, v_n, v_esp_v ->> k;
    end if;
  end loop;

  -- T3. Lucas (VAREJO): carimbo automatico, rejeicao de operacao_id informado e de mudanca de operacao
  execute format('insert into public.cupons_evento (codigo, tipo, valor) values (%L, %L, 1) returning operacao_id', 'ZZENSAIO2', 'valor') into v_op;
  if v_op is distinct from v_varejo then raise exception 'TESTE FALHOU [T3 carimbo]: gravou na operacao %', v_op; end if;
  begin
    execute format('insert into public.cupons_evento (codigo, tipo, valor, operacao_id) values (%L, %L, 1, %L)', 'ZZENSAIO1', 'valor', v_atacado);
    raise exception 'TESTE FALHOU [T3]: INSERT com operacao_id informado foi aceito';
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute format('update public.cupons_evento set operacao_id = %L where codigo = %L', v_atacado, 'ZZENSAIO2');
    raise exception 'TESTE FALHOU [T3]: UPDATE de operacao_id foi aceito';
  exception when insufficient_privilege then
    null;
  end;

  -- T4. Guarda das functions do atacado em contexto VAREJO (guarda dispara antes de qualquer efeito)
  begin
    perform public.extornar_pedido(v_pedido);
    raise exception 'TESTE FALHOU [T4]: extornar_pedido rodou em contexto VAREJO';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- T5. Barbara (vendedora do ATACADO): sem acesso ao VAREJO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_op := public.operacao_atual();
  if v_op is distinct from v_atacado then raise exception 'TESTE FALHOU [T5 Barbara]: operacao_atual = %', v_op; end if;
  execute 'select count(*) from public.pedidos' into v_n;
  if v_n <> (v_esp_a ->> 'pedidos')::bigint then raise exception 'TESTE FALHOU [T5 Barbara]: pedidos = %, esperado %', v_n, v_esp_a ->> 'pedidos'; end if;
  foreach k in array array['vendas_evento', 'vendas_evento_itens', 'produtos_evento', 'movimentacoes_estoque_evento',
                           'movimentos_caixa_evento', 'aberturas_caixa_evento', 'fechamentos_caixa_evento', 'cupons_evento'] loop
    execute format('select count(*) from public.%I', k) into v_n;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T5 Barbara]: enxerga % linhas de % (VAREJO)', v_n, k; end if;
  end loop;
  execute 'select count(*) from public.permissoes_usuario' into v_n;
  if v_n <> v_ea_perm then raise exception 'TESTE FALHOU [T5 Barbara]: permissoes visiveis = %, esperado %', v_n, v_ea_perm; end if;
  execute format('select public.tem_permissao(%L::public.permissao_especial)', v_perm) into v_ok;
  if v_ok is not true then raise exception 'TESTE FALHOU [T5 Barbara]: tem_permissao(%) deveria ser true no ATACADO', v_perm; end if;
  begin
    perform public.criar_venda_evento(p_itens => '[]'::jsonb, p_forma_pagamento => 'dinheiro');
    raise exception 'TESTE FALHOU [T5]: criar_venda_evento rodou em contexto ATACADO';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- T6. Barbara com claim FORJADO de VAREJO: ignorado, continua ATACADO e sem ver o VAREJO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  v_op := public.operacao_atual();
  if v_op is distinct from v_atacado then raise exception 'TESTE FALHOU [T6 claim forjado]: operacao_atual = %', v_op; end if;
  execute 'select count(*) from public.vendas_evento' into v_n;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T6 claim forjado]: viu % vendas de evento', v_n; end if;
  execute 'reset role';

  -- T7. TESTE TESTE (sem operacao): falha fechada
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_teste, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_op := public.operacao_atual();
  if v_op is not null then raise exception 'TESTE FALHOU [T7 TESTE TESTE]: operacao_atual = %, esperado NULL', v_op; end if;
  foreach k in array array['pedidos', 'clientes', 'produtos', 'pedido_itens', 'movimentos_estoque'] loop
    execute format('select count(*) from public.%I', k) into v_n;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T7 TESTE TESTE]: enxerga % linhas de %', v_n, k; end if;
  end loop;
  execute 'reset role';

  -- T8. Anonimo: sem contexto e sem dados
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  v_op := public.operacao_atual();
  if v_op is not null then raise exception 'TESTE FALHOU [T8 anon]: operacao_atual = %', v_op; end if;
  execute 'select count(*) from public.pedidos' into v_n;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T8 anon]: enxerga % pedidos', v_n; end if;
  execute 'reset role';

  -- T9. Guardas de registro, chamadas como dono com o contexto do Lucas
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  if v_venda is not null then
    begin
      perform public.exigir_operacao('vendas_evento', v_venda);
      raise exception 'TESTE FALHOU [T9]: exigir_operacao aceitou venda VAREJO em contexto ATACADO';
    exception when insufficient_privilege then
      null;
    end;
  end if;
  perform public.exigir_operacao_codigo('ATACADO');
  begin
    perform public.exigir_operacao_codigo('VAREJO');
    raise exception 'TESTE FALHOU [T9]: exigir_operacao_codigo(VAREJO) passou em contexto ATACADO';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  if v_venda is not null then
    perform public.exigir_operacao('vendas_evento', v_venda);
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T9 (claim valido, forjado, sem operacao, anon, carimbo, rejeicoes, guardas).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_def text;
  v_novo text;
  r record;
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  drop policy if exists "escopo de operacao notinhas" on storage.objects;

  for r in select funcao, bloco from _op_guardas order by funcao loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.funcao;
    if v_def is not null then
      v_novo := replace(v_def, r.bloco, '');
      if v_novo <> v_def then
        execute v_novo;
      end if;
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tem_permissao';
  if v_def is not null then
    v_novo := replace(v_def, ' and operacao_id = public.operacao_atual()', '');
    if v_novo <> v_def then
      execute v_novo;
    end if;
  end if;

  for r in select tabela, dono, obrigatoria from _op_tabelas order by tabela loop
    execute format('drop policy if exists "escopo de operacao" on public.%I', r.tabela);
    if r.obrigatoria then
      execute format('drop trigger if exists trg_carimbar_operacao on public.%I', r.tabela);
      execute format('drop trigger if exists trg_travar_operacao on public.%I', r.tabela);
      execute format('alter table public.%I alter column operacao_id set default %L', r.tabela,
                     case r.dono when 'ATACADO' then v_atacado else v_varejo end);
    else
      execute format('drop trigger if exists trg_carimbar_operacao_auditoria on public.%I', r.tabela);
    end if;
  end loop;

  drop function if exists public.carimbar_operacao_auditoria();
  drop function if exists public.travar_operacao();
  drop function if exists public.carimbar_operacao();
  drop function if exists public.contexto_sessao();
  drop function if exists public.exigir_operacao_codigo(text);
  drop function if exists public.exigir_operacao(text, uuid);
  drop function if exists public.operacao_atual();

  drop index if exists public.usuario_operacoes_padrao_key;
  alter table public.usuario_operacoes drop column if exists padrao;

  delete from public.pending_decisions where chave in (select chave from _op2_pendencias);
  update public.pending_decisions
     set ativo = false, decidido_em = null, decidido_por = null, decisao = null
   where chave = 'remover_default_operacao_id';
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

  raise exception 'ENSAIO OK: etapa 2 aplicada, verificada, testada (T1 a T9) e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
drop function if exists pg_temp.fp_schema();
notify pgrst, 'reload schema';

commit;

-- VERIFICACAO POS-APLICACAO (so leem):
--   select table_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'operacao_id' and column_default is not null order by 1;  -- 0 linhas
--   select policyname, count(*) from pg_policies where policyname like 'escopo de operacao%' group by 1;      -- 31 + 1
--   select public.contexto_sessao();  -- como usuario logado no app
