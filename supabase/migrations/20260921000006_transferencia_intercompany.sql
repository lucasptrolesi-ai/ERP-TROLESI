-- Etapa 5b do modulo de varejo: transferencia entre operacoes, intercompany e consolidado.
-- Pre-requisito: etapas 1 a 5a aplicadas.
--
-- O QUE FAZ (uma transacao so):
--   1. transferir_estoque(): UNICO ponto do sistema que le o multiplicador (parametros_multiplicador,
--      com vigencia). custo = arredondar_moeda(codigo_peca x multiplicador vigente). Baixa o estoque do
--      atacado (modelo legado), da entrada no varejo em estoque_movimentos COM esse custo congelado e
--      gera, no mesmo ato, contas_receber no atacado e contas_pagar no varejo, ambas
--      intercompany = true. E a unica rotina autorizada a gravar em duas operacoes (app.transferencia).
--      Somente admin, e somente em contexto ATACADO.
--   2. contas_pagar / contas_receber ganham intercompany, contraparte_operacao_id e transferencia_id.
--      O atacado registra o varejo como um cliente marcado (clientes.intercompany_operacao_id), o que
--      faz a conta aparecer na tela de contas a receber sem mudar o app.
--   3. relatorio_consolidado(): so admin; soma as operacoes e ELIMINA os lancamentos intercompany.
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

create temp table _op6_pendencias (chave text primary key, descricao text not null) on commit drop;

insert into _op6_pendencias (chave, descricao) values
  ('prazo_intercompany',
   'O vencimento da conta intercompany e informado na transferencia; sem informar, usa hoje + 30 dias. Confirmar o prazo com o usuario.'),
  ('clientes_intercompany_relatorios',
   'O atacado representa o varejo como cliente (clientes.intercompany_operacao_id). Filtrar esses clientes de relatorios de cliente inativo, primeira compra e crediario.'),
  ('operacoes_tipo_generico',
   'As funcoes do varejo e do consolidado estao acopladas aos codigos ATACADO e VAREJO. Criar operacoes.tipo para suportar mais operacoes sem alterar funcoes.'),
  ('transferencia_estorno',
   'Nao ha estorno de transferencia (nem devolucao do varejo ao atacado). Deve gerar movimentos e lancamentos intercompany inversos.'),
  ('transferencia_vinculo_produto',
   'Cada transferencia informa produto do atacado e variacao do varejo; nao ha tabela de vinculo permanente. Criar vinculo para reposicao automatica e relatorios.');

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
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'D pending_decisions ' || count(*) || ' ' || count(*) filter (where ativo) from public.pending_decisions;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid)') is null then
    raise exception 'ABORTADO: etapa 5a nao aplicada (registrar_venda ausente).';
  end if;
  if to_regclass('public.transferencias') is not null then
    raise exception 'ABORTADO: etapa 5b parece ja aplicada (transferencias existe).';
  end if;

  -- 1. Tabelas de transferencia ---------------------------------------------------------------------------
  create table public.transferencias (
    id uuid primary key default gen_random_uuid(),
    numero bigint not null,
    operacao_origem_id uuid not null references public.operacoes (id),
    operacao_destino_id uuid not null references public.operacoes (id),
    multiplicador numeric(8, 4) not null check (multiplicador > 0),
    total numeric(12, 2) not null default 0 check (total >= 0),
    vencimento date not null,
    conta_receber_id uuid,
    conta_pagar_id uuid,
    criada_por uuid references public.profiles (id),
    criada_em timestamptz not null default now(),
    constraint transferencias_origem_numero_key unique (operacao_origem_id, numero),
    constraint transferencias_origem_destino check (operacao_origem_id <> operacao_destino_id)
  );

  create table public.transferencia_itens (
    id uuid primary key default gen_random_uuid(),
    transferencia_id uuid not null references public.transferencias (id),
    produto_origem_id uuid not null references public.produtos (id),
    variacao_destino_id uuid not null references public.catalogo_variacoes (id),
    quantidade integer not null check (quantidade > 0),
    codigo_peca numeric(12, 2) not null check (codigo_peca > 0),
    custo_unitario numeric(12, 2) not null check (custo_unitario > 0)
  );
  create index transferencia_itens_transferencia_idx on public.transferencia_itens (transferencia_id);

  create trigger trg_transferencias_sem_delete before delete on public.transferencias
    for each row execute function public.bloquear_alteracao_registro();
  create trigger trg_transferencias_sem_truncate before truncate on public.transferencias
    for each statement execute function public.bloquear_alteracao_registro();
  create trigger trg_transferencia_itens_append_only before update or delete on public.transferencia_itens
    for each row execute function public.bloquear_alteracao_registro();

  alter table public.transferencias enable row level security;
  alter table public.transferencia_itens enable row level security;

  create policy "escopo de operacao" on public.transferencias as restrictive for all to public
    using (operacao_origem_id = (select public.operacao_atual()) or operacao_destino_id = (select public.operacao_atual()))
    with check (operacao_origem_id = (select public.operacao_atual()) or operacao_destino_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.transferencia_itens as restrictive for all to public
    using (exists (select 1 from public.transferencias t where t.id = transferencia_itens.transferencia_id))
    with check (exists (select 1 from public.transferencias t where t.id = transferencia_itens.transferencia_id));
  create policy "admin le transferencias" on public.transferencias for select to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin le transferencia_itens" on public.transferencia_itens for select to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario);

  revoke all on public.transferencias, public.transferencia_itens from anon, authenticated;
  grant select on public.transferencias, public.transferencia_itens to authenticated;

  -- 2. Intercompany nas contas e no cliente ------------------------------------------------------------------
  alter table public.contas_pagar
    add column intercompany boolean not null default false,
    add column contraparte_operacao_id uuid references public.operacoes (id),
    add column transferencia_id uuid references public.transferencias (id),
    add constraint contas_pagar_intercompany_check check ((not intercompany and contraparte_operacao_id is null) or (intercompany and contraparte_operacao_id is not null));
  alter table public.contas_receber
    add column intercompany boolean not null default false,
    add column contraparte_operacao_id uuid references public.operacoes (id),
    add column transferencia_id uuid references public.transferencias (id),
    add constraint contas_receber_intercompany_check check ((not intercompany and contraparte_operacao_id is null) or (intercompany and contraparte_operacao_id is not null));
  alter table public.clientes add column intercompany_operacao_id uuid references public.operacoes (id);
  create unique index clientes_intercompany_key on public.clientes (operacao_id, intercompany_operacao_id) where intercompany_operacao_id is not null;

  -- 3. Transferencia (unico ponto que conhece o multiplicador) ------------------------------------------------
  create or replace function public.transferir_estoque(p_destino_codigo text, p_itens jsonb, p_vencimento date default null) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_origem uuid := public.operacao_atual();
    v_origem_cod text;
    v_destino uuid;
    v_dep uuid;
    v_mult numeric;
    v_venc date := coalesce(p_vencimento, current_date + 30);
    v_numero bigint;
    v_t uuid;
    v_item jsonb;
    v_prod uuid;
    v_var uuid;
    v_qtd integer;
    v_codigo numeric;
    v_est integer;
    v_nome text;
    v_custo numeric;
    v_total numeric := 0;
    v_cli uuid;
    v_cr uuid;
    v_cp uuid;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('ATACADO');
    if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
      raise exception 'Informe ao menos um item';
    end if;
    if v_venc < current_date then
      raise exception 'Vencimento no passado';
    end if;
    select o.codigo into v_origem_cod from public.operacoes o where o.id = v_origem;
    select o.id into v_destino from public.operacoes o where o.codigo = p_destino_codigo and o.id <> v_origem;
    if v_destino is null then
      raise exception 'Operacao de destino invalida';
    end if;
    select d.id into v_dep from public.depositos d
     where d.operacao_id = v_destino and d.ativo and d.tipo = 'loja' order by d.nome limit 1;
    if v_dep is null then
      raise exception 'A operacao de destino nao tem deposito de loja';
    end if;
    v_mult := public.multiplicador_vigente('TRANSFERENCIA_' || v_origem_cod || '_' || p_destino_codigo, current_date);

    -- A partir daqui esta rotina grava nas duas operacoes (unica autorizada).
    perform set_config('app.transferencia', 'on', true);
    v_numero := public.proximo_numero_operacao('transferencia');
    insert into public.transferencias (numero, operacao_origem_id, operacao_destino_id, multiplicador, vencimento, criada_por)
    values (v_numero, v_origem, v_destino, v_mult, v_venc, auth.uid()) returning id into v_t;

    for v_item in select e from jsonb_array_elements(p_itens) e loop
      v_prod := (v_item ->> 'produto_origem_id')::uuid;
      v_var := (v_item ->> 'variacao_destino_id')::uuid;
      v_qtd := (v_item ->> 'quantidade')::integer;
      if v_qtd is null or v_qtd <= 0 then
        raise exception 'Quantidade invalida';
      end if;
      select p.codigo_peca, p.quantidade_estoque, p.nome into v_codigo, v_est, v_nome
        from public.produtos p where p.id = v_prod and p.operacao_id = v_origem for update;
      if not found then
        raise exception 'Produto do atacado nao encontrado';
      end if;
      if coalesce(v_codigo, 0) <= 0 then
        raise exception 'Produto % sem codigo de atacado', v_nome;
      end if;
      if v_est < v_qtd then
        raise exception 'Estoque insuficiente no atacado para % (saldo %, pedido %)', v_nome, v_est, v_qtd;
      end if;
      if not exists (select 1 from public.catalogo_variacoes cv where cv.id = v_var and cv.operacao_id = v_destino and cv.ativo) then
        raise exception 'Variacao de destino invalida';
      end if;
      v_custo := public.arredondar_moeda(v_codigo * v_mult);
      if v_custo <= 0 then
        raise exception 'Custo calculado invalido';
      end if;

      update public.produtos set quantidade_estoque = quantidade_estoque - v_qtd where id = v_prod;
      insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo, criado_por, operacao_id)
      values (v_prod, 'saida', v_qtd, 'TRANSFERENCIA #' || v_numero || ' PARA ' || p_destino_codigo, auth.uid(), v_origem);
      insert into public.estoque_movimentos (operacao_id, deposito_id, variacao_id, tipo, quantidade, custo_unitario, documento_tipo, documento_id, criado_por)
      values (v_destino, v_dep, v_var, 'transferencia_entrada', v_qtd, v_custo, 'transferencia', v_t, auth.uid());
      insert into public.transferencia_itens (transferencia_id, produto_origem_id, variacao_destino_id, quantidade, codigo_peca, custo_unitario)
      values (v_t, v_prod, v_var, v_qtd, v_codigo, v_custo);

      v_total := v_total + public.arredondar_moeda(v_custo * v_qtd);
    end loop;

    select c.id into v_cli from public.clientes c where c.operacao_id = v_origem and c.intercompany_operacao_id = v_destino;
    if v_cli is null then
      insert into public.clientes (nome, intercompany_operacao_id) values ('INTERCOMPANY - ' || p_destino_codigo, v_destino)
      returning id into v_cli;
    end if;
    insert into public.contas_receber (cliente_id, valor, vencimento, intercompany, contraparte_operacao_id, transferencia_id)
    values (v_cli, v_total, v_venc, true, v_destino, v_t) returning id into v_cr;
    insert into public.contas_pagar (operacao_id, descricao, valor, vencimento, intercompany, contraparte_operacao_id, transferencia_id)
    values (v_destino, 'TRANSFERENCIA #' || v_numero || ' DO ' || v_origem_cod, v_total, v_venc, true, v_origem, v_t)
    returning id into v_cp;

    update public.transferencias set total = v_total, conta_receber_id = v_cr, conta_pagar_id = v_cp where id = v_t;
    perform set_config('app.transferencia', 'off', true);

    perform public.registrar_auditoria('transferencias', v_t, 'transferencia_estoque', null,
      jsonb_build_object('numero', v_numero, 'origem', v_origem_cod, 'destino', p_destino_codigo, 'total', v_total, 'vencimento', v_venc), null);
    return v_t;
  end
  $fn$;

  -- 4. Consolidado (elimina intercompany) ------------------------------------------------------------------------
  create or replace function public.relatorio_consolidado(p_inicio date, p_fim date) returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_res jsonb;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    if p_inicio is null or p_fim is null or p_fim < p_inicio then
      raise exception 'Periodo invalido';
    end if;
    with por_op as (
      select o.id, o.codigo,
        case o.codigo
          when 'ATACADO' then (select coalesce(sum(p.total), 0) from public.pedidos p
                                where p.operacao_id = o.id and p.status = 'faturado'
                                  and (p.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim)
          when 'VAREJO' then (select coalesce(sum(v.total), 0) from public.vendas v
                                where v.operacao_id = o.id and v.status = 'concluida'
                                  and (v.criada_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim)
          else 0::numeric
        end as receita,
        (select coalesce(sum(c.valor), 0) from public.contas_receber c where c.operacao_id = o.id and c.situacao <> 'pago') as a_receber,
        (select coalesce(sum(c.valor), 0) from public.contas_receber c where c.operacao_id = o.id and c.situacao <> 'pago' and c.intercompany) as a_receber_ic,
        (select coalesce(sum(c.valor), 0) from public.contas_pagar c where c.operacao_id = o.id and c.situacao <> 'pago') as a_pagar,
        (select coalesce(sum(c.valor), 0) from public.contas_pagar c where c.operacao_id = o.id and c.situacao <> 'pago' and c.intercompany) as a_pagar_ic
      from public.operacoes o
    )
    select jsonb_build_object(
      'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
      'operacoes', coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'receita', receita, 'a_receber', a_receber, 'a_pagar', a_pagar,
                     'a_receber_intercompany', a_receber_ic, 'a_pagar_intercompany', a_pagar_ic) order by codigo), '[]'::jsonb),
      'consolidado', jsonb_build_object(
        'receita', coalesce(sum(receita), 0),
        'a_receber', coalesce(sum(a_receber - a_receber_ic), 0),
        'a_pagar', coalesce(sum(a_pagar - a_pagar_ic), 0),
        'intercompany_eliminado_a_receber', coalesce(sum(a_receber_ic), 0),
        'intercompany_eliminado_a_pagar', coalesce(sum(a_pagar_ic), 0)))
    into v_res from por_op;
    return v_res;
  end
  $fn$;

  revoke execute on function public.transferir_estoque(text, jsonb, date), public.relatorio_consolidado(date, date) from public, anon, authenticated;
  grant execute on function public.transferir_estoque(text, jsonb, date), public.relatorio_consolidado(date, date) to authenticated;

  insert into public.pending_decisions (chave, descricao, ativo)
  select chave, descricao, false from _op6_pendencias;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
  v_m bigint;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name in ('contas_pagar', 'contas_receber')
     and column_name in ('intercompany', 'contraparte_operacao_id', 'transferencia_id');
  if v_n <> 6 then raise exception 'FALHA: colunas intercompany = %, esperado 6', v_n; end if;

  select count(*) into v_n from public.contas_pagar where intercompany;
  select count(*) into v_m from public.contas_receber where intercompany;
  if v_n <> 0 or v_m <> 0 then raise exception 'FALHA: ja ha lancamentos intercompany antes de qualquer transferencia'; end if;

  select count(*) into v_n from public.pending_decisions where chave in (select chave from _op6_pendencias);
  select count(*) into v_m from _op6_pendencias;
  if v_n <> v_m then raise exception 'FALHA: pendencias = %, esperado %', v_n, v_m; end if;

  raise notice 'VERIFICACAO OK: transferencias, intercompany, consolidado.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_prod_at uuid;
  v_codigo numeric;
  v_est integer;
  v_custo numeric;
  v_prod uuid;
  v_var uuid;
  v_t uuid;
  v_res jsonb;
  v_esp numeric;
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select p.id, p.codigo_peca, p.quantidade_estoque into v_prod_at, v_codigo, v_est
    from public.produtos p where p.operacao_id = v_atacado and p.codigo_peca > 0 and p.quantidade_estoque >= 3
   order by p.quantidade_estoque desc limit 1;
  if v_prod_at is null then
    raise exception 'ENSAIO INCONCLUSIVO: nenhum produto do atacado com codigo_peca > 0 e estoque >= 3';
  end if;
  v_custo := public.arredondar_moeda(v_codigo * 2.8);

  -- Preparo: Lucas cria no varejo o produto/variacao de destino
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  insert into public.catalogo_produtos (nome, categoria) values ('ZZ ENSAIO TRANSFERENCIA', 'ANEL') returning id into v_prod;
  insert into public.catalogo_variacoes (produto_id, sku, preco_venda) values (v_prod, 'ZZTRF-1', 500.00) returning id into v_var;
  execute 'set constraints all immediate';
  execute 'reset role';

  -- T1. Transferencia (Lucas, admin, contexto ATACADO): 2 pecas
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_t := public.transferir_estoque('VAREJO', jsonb_build_array(jsonb_build_object(
           'produto_origem_id', v_prod_at, 'variacao_destino_id', v_var, 'quantidade', 2)), current_date + 30);
  execute 'reset role';

  select count(*) into v_n from public.transferencias
   where id = v_t and numero = 1 and operacao_origem_id = v_atacado and operacao_destino_id = v_varejo
     and total = v_custo * 2 and multiplicador = 2.8;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: cabecalho da transferencia incorreto'; end if;
  select count(*) into v_n from public.estoque_movimentos
   where documento_id = v_t and tipo = 'transferencia_entrada' and quantidade = 2 and custo_unitario = v_custo and operacao_id = v_varejo;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: entrada no varejo sem o custo congelado (esperado %)', v_custo; end if;
  select count(*) into v_n from public.transferencia_itens where transferencia_id = v_t and custo_unitario = v_custo and codigo_peca = v_codigo;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: item da transferencia nao guardou codigo e custo'; end if;
  select count(*) into v_n from public.produtos where id = v_prod_at and quantidade_estoque = v_est - 2;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: estoque do atacado nao baixou 2'; end if;
  select count(*) into v_n from public.movimentos_estoque
   where produto_id = v_prod_at and tipo = 'saida' and quantidade = 2 and operacao_id = v_atacado and motivo like 'TRANSFERENCIA #1%';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: movimento de saida do atacado ausente'; end if;

  -- T2. Contas intercompany nos dois lados, vinculadas
  select count(*) into v_n from public.contas_receber
   where transferencia_id = v_t and intercompany and contraparte_operacao_id = v_varejo and operacao_id = v_atacado and valor = v_custo * 2;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: contas_receber intercompany do atacado incorreta'; end if;
  select count(*) into v_n from public.contas_pagar
   where transferencia_id = v_t and intercompany and contraparte_operacao_id = v_atacado and operacao_id = v_varejo and valor = v_custo * 2;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: contas_pagar intercompany do varejo incorreta'; end if;
  select count(*) into v_n from public.clientes where operacao_id = v_atacado and intercompany_operacao_id = v_varejo;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: cliente intercompany nao foi criado no atacado'; end if;
  if coalesce(current_setting('app.transferencia', true), '') <> 'off' then
    raise exception 'TESTE FALHOU [T2]: a liberacao app.transferencia ficou ligada';
  end if;
  select count(*) into v_n from public.audit_log where acao = 'transferencia_estoque' and registro_id = v_t;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: transferencia nao foi auditada'; end if;

  -- T3. Consolidado elimina o intercompany
  v_res := public.relatorio_consolidado(current_date - 30, current_date + 30);
  if (v_res -> 'consolidado' ->> 'intercompany_eliminado_a_receber')::numeric <> v_custo * 2
     or (v_res -> 'consolidado' ->> 'intercompany_eliminado_a_pagar')::numeric <> v_custo * 2 then
    raise exception 'TESTE FALHOU [T3]: consolidado nao eliminou o intercompany: %', v_res -> 'consolidado';
  end if;
  select coalesce(sum(c.valor), 0) into v_esp from public.contas_receber c where c.situacao <> 'pago' and not c.intercompany;
  if (v_res -> 'consolidado' ->> 'a_receber')::numeric <> v_esp then
    raise exception 'TESTE FALHOU [T3]: a_receber consolidado = %, esperado % (sem intercompany)', v_res -> 'consolidado' ->> 'a_receber', v_esp;
  end if;

  -- T4. Isolamento: cada operacao ve so o seu lado
  execute 'set local role authenticated';
  select count(*) into v_n from public.contas_pagar where intercompany;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T4]: atacado viu % contas a pagar do varejo', v_n; end if;
  select count(*) into v_n from public.contas_receber where intercompany;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: atacado viu % contas a receber intercompany, esperado 1', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.contas_pagar where intercompany;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: varejo viu % contas a pagar intercompany, esperado 1', v_n; end if;
  select count(*) into v_n from public.contas_receber where intercompany;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T4]: varejo viu % contas a receber do atacado', v_n; end if;

  -- T5. Fora da transferencia, informar operacao_id continua proibido
  v_ok := false;
  begin
    execute format('insert into public.contas_pagar (operacao_id, descricao, valor, vencimento) values (%L, %L, 1, current_date)', v_atacado, 'x');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: operacao_id informado fora da transferencia foi aceito'; end if;

  -- T6. Transferir so no contexto ATACADO (admin em contexto VAREJO e barrado)
  v_ok := false;
  begin
    perform public.transferir_estoque('ATACADO', jsonb_build_array(jsonb_build_object(
      'produto_origem_id', v_prod_at, 'variacao_destino_id', v_var, 'quantidade', 1)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T6]: transferencia partiu do contexto VAREJO'; end if;
  execute 'reset role';

  -- T7. Vendedora nao transfere nem le transferencias; estoque insuficiente e barrado
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.transferir_estoque('VAREJO', jsonb_build_array(jsonb_build_object(
      'produto_origem_id', v_prod_at, 'variacao_destino_id', v_var, 'quantidade', 1)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: vendedora conseguiu transferir'; end if;
  select count(*) into v_n from public.transferencias;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T7]: vendedora leu % transferencias', v_n; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.transferir_estoque('VAREJO', jsonb_build_array(jsonb_build_object(
      'produto_origem_id', v_prod_at, 'variacao_destino_id', v_var, 'quantidade', 999999)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: transferencia acima do estoque do atacado foi aceita'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T7 (transferencia com custo pelo multiplicador, intercompany, consolidado, isolamento, permissoes).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.relatorio_consolidado(date, date);
  drop function if exists public.transferir_estoque(text, jsonb, date);

  drop index if exists public.clientes_intercompany_key;
  alter table public.clientes drop column if exists intercompany_operacao_id;
  alter table public.contas_receber drop constraint if exists contas_receber_intercompany_check,
    drop column if exists transferencia_id, drop column if exists contraparte_operacao_id, drop column if exists intercompany;
  alter table public.contas_pagar drop constraint if exists contas_pagar_intercompany_check,
    drop column if exists transferencia_id, drop column if exists contraparte_operacao_id, drop column if exists intercompany;

  drop table if exists public.transferencia_itens, public.transferencias;

  delete from public.pending_decisions where chave in (select chave from _op6_pendencias);
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
      from pg_proc p where p.pronamespace = 'public'::regnamespace
    union all
    select 'D pending_decisions ' || count(*) || ' ' || count(*) filter (where ativo) from public.pending_decisions;

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: etapa 5b aplicada, verificada, testada (T1 a T7) e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
