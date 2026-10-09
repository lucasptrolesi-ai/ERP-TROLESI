-- Dívida com o Atacado por cadastro direto no Varejo (pedido do usuário, 2026-10-09): ele NAO quer
-- usar a transferência formal Atacado->Varejo (transferir_estoque, 20260921000006) pra receber peça
-- nova -- ele digita o "código" do Atacado direto no cadastro da peça no catálogo do Varejo
-- (ex: código 10.0 x fator 2,8 = custo 28,00) e o sistema:
--   1. calcula o custo (código * fator vigente, mesma fonte parametros_multiplicador/
--      multiplicador_vigente já usada em transferir_estoque -- "motor único", não duplica a conta);
--   2. registra a entrada de estoque de verdade (chama registrar_entrada_estoque existente, NAO
--      duplica a lógica de estoque_movimentos);
--   3. registra o quanto fica devendo ao Atacado por essa compra, com status pago/em_aberto.
--
-- Decisão explícita do usuário (AskUserQuestion + mensagens diretas, 2026-10-09): NAO ligar isso em
-- contas_pagar/contas_receber/transferencias (mecanismo oficial intercompany, Atacado-only,
-- inacessível do contexto Varejo) -- é um ledger PARALELO, isolado dentro do módulo Controle
-- Financeiro do Varejo, mesmo padrão de operacao_id/admin-only das 6 tabelas de 20261008000001.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo (o bloco DO $down$ mais abaixo devolve tudo ao estado anterior, testado pelo próprio modo
-- -- 'ensaio' antes de chegar aqui):
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque só esta linha): 'ensaio' | 'aplicar' | 'desfazer'
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
    select 'TAB ' || t.table_name as item from information_schema.tables t
     where t.table_schema = 'public' and t.table_name = 'varejo_dividas_atacado'
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname = 'registrar_compra_atacado_varejo'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  -- 1. varejo_dividas_atacado: uma linha por compra registrada no cadastro da peça --------------
  create table public.varejo_dividas_atacado (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    variacao_id uuid not null references public.catalogo_variacoes (id),
    movimento_estoque_id uuid not null references public.estoque_movimentos (id),
    codigo_atacado numeric(10, 2) not null check (codigo_atacado > 0),
    fator_custo numeric(8, 4) not null check (fator_custo > 0),
    quantidade integer not null check (quantidade >= 1),
    custo_unitario numeric(12, 2) not null check (custo_unitario >= 0),
    custo_total numeric(12, 2) not null check (custo_total >= 0),
    status text not null check (status in ('em_aberto', 'pago')) default 'em_aberto',
    pago_em timestamptz,
    observacao text,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint varejo_dividas_atacado_pago_coerente check (
      (status = 'pago' and pago_em is not null) or (status = 'em_aberto' and pago_em is null)
    )
  );
  create index varejo_dividas_atacado_operacao_idx on public.varejo_dividas_atacado (operacao_id, status);
  create index varejo_dividas_atacado_variacao_idx on public.varejo_dividas_atacado (variacao_id);

  -- 2. Função que amarra as 3 pontas numa transação só: calcula custo, chama a entrada de estoque
  -- já existente (não duplica a lógica de estoque_movimentos) e grava a dívida -------------------
  create or replace function public.registrar_compra_atacado_varejo(
    p_variacao_id uuid, p_deposito_id uuid, p_codigo_atacado numeric, p_quantidade integer,
    p_status text default 'em_aberto', p_observacao text default null
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_fator numeric;
    v_custo_unitario numeric;
    v_custo_total numeric;
    v_movimento uuid;
    v_divida uuid;
    v_status text := coalesce(p_status, 'em_aberto');
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    if p_codigo_atacado is null or p_codigo_atacado <= 0 then
      raise exception 'Informe o codigo do Atacado (maior que zero)';
    end if;
    if p_quantidade is null or p_quantidade <= 0 then
      raise exception 'Quantidade deve ser maior que zero';
    end if;
    if v_status not in ('em_aberto', 'pago') then
      raise exception 'Status invalido: %', v_status;
    end if;

    -- Mesma fonte de verdade do multiplicador usada em transferir_estoque (20260921000006) -- se
    -- mudar o 2,8x lá, muda aqui tambem sozinho, sem duplicar constante nenhuma.
    v_fator := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
    v_custo_unitario := public.arredondar_moeda(p_codigo_atacado * v_fator);
    v_custo_total := public.arredondar_moeda(v_custo_unitario * p_quantidade);

    -- Reusa a function de entrada de estoque ja existente (20260921000003): nao duplica a logica de
    -- estoque_movimentos (append-only, auditoria, etc) aqui.
    v_movimento := public.registrar_entrada_estoque(
      p_deposito_id, p_variacao_id, p_quantidade, v_custo_unitario,
      'Compra do Atacado -- codigo ' || p_codigo_atacado::text
    );

    insert into public.varejo_dividas_atacado
      (variacao_id, movimento_estoque_id, codigo_atacado, fator_custo, quantidade, custo_unitario, custo_total,
       status, pago_em, observacao)
    values
      (p_variacao_id, v_movimento, p_codigo_atacado, v_fator, p_quantidade, v_custo_unitario, v_custo_total,
       v_status, case when v_status = 'pago' then now() else null end, nullif(trim(coalesce(p_observacao, '')), ''))
    returning id into v_divida;

    return v_divida;
  end
  $fn$;
  revoke execute on function public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text) from public, anon, authenticated;
  grant execute on function public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text) to authenticated;

  -- 3. Triggers -- mesmo padrao de operacao_id das outras tabelas do modulo, reusando as functions
  -- genericas ja criadas em 20261008000001 (nao recria nada, so "pluga" nesta tabela nova) --------
  create trigger trg_carimbar_operacao before insert on public.varejo_dividas_atacado for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_dividas_atacado for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_dividas_atacado for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_atualizado_em before update on public.varejo_dividas_atacado for each row execute function public.set_atualizado_em();
  create trigger trg_auditar_financeiro_varejo after insert or update or delete on public.varejo_dividas_atacado for each row execute function public.auditar_financeiro_varejo();

  -- 4. RLS: mesmo par restritiva (escopo operacao) + permissiva (admin-only) das outras 6 tabelas -
  alter table public.varejo_dividas_atacado enable row level security;
  create policy "escopo de operacao" on public.varejo_dividas_atacado as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "admin gerencia varejo_dividas_atacado" on public.varejo_dividas_atacado for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);

  -- 5. Grants: igual ao resto do modulo (revoke primeiro -- default privilege do Supabase podia
  -- sobrar acesso por baixo do grant mais estreito, mesmo padrao de 20261008000001) --------------
  revoke all on public.varejo_dividas_atacado from anon, public, authenticated;
  grant select, insert, update, delete on public.varejo_dividas_atacado to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regclass('public.varejo_dividas_atacado') is null then
    raise exception 'FALHA: varejo_dividas_atacado nao existe';
  end if;
  if not (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'varejo_dividas_atacado') then
    raise exception 'FALHA: varejo_dividas_atacado sem RLS ligada';
  end if;
  if to_regprocedure('public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text)') is null then
    raise exception 'FALHA: registrar_compra_atacado_varejo nao existe';
  end if;
  if has_table_privilege('anon', 'public.varejo_dividas_atacado', 'SELECT') then
    raise exception 'FALHA: anon com select em varejo_dividas_atacado';
  end if;

  raise notice 'VERIFICACAO OK: tabela, RLS, function e grants no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_atacado uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_vendedor uuid;
  v_estoque uuid;
  v_dep uuid;
  v_fator numeric;
  v_fator_gravado numeric;
  v_prod uuid;
  v_var uuid;
  v_divida uuid;
  v_divida2 uuid;
  v_n bigint;
  v_custo_unit numeric;
  v_custo_total numeric;
  v_mov uuid;
  v_status text;
  v_pago_em timestamptz;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  select id into v_vendedor from public.profiles where papel = 'vendedor' limit 1;
  select id into v_estoque from public.profiles where papel = 'estoque' limit 1;

  -- Le o fator ANTES de trocar pro papel authenticated: multiplicador_vigente() tem o execute
  -- revogado de authenticated (só é chamável de dentro de uma SECURITY DEFINER, como a function que
  -- este teste está validando) -- chamar direto já impersonando authenticated daria "permission
  -- denied" aqui no teste, mesmo a function de produção funcionando normalmente.
  v_fator := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- Peca de apoio pros testes (igual o fluxo real: admin cadastra a peca primeiro)
  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO DIVIDA ATACADO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', '', 'atributos', '{}'::jsonb, 'preco_venda', 84.90)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;

  -- T1. Compra em_aberto (default): custo = codigo * fator vigente, entrada de estoque criada,
  -- divida gravada coerente (custo_total = custo_unitario * quantidade, pago_em nulo)
  v_divida := public.registrar_compra_atacado_varejo(v_var, v_dep, 8.4, 3);
  select custo_unitario, custo_total, status, pago_em, movimento_estoque_id, fator_custo
    into v_custo_unit, v_custo_total, v_status, v_pago_em, v_mov, v_fator_gravado
    from public.varejo_dividas_atacado where id = v_divida;
  if v_fator_gravado <> v_fator then
    raise exception 'TESTE FALHOU [T1]: fator_custo gravado (%) nao bate com multiplicador_vigente (%)', v_fator_gravado, v_fator;
  end if;
  if v_custo_unit <> public.arredondar_moeda(8.4 * v_fator) then
    raise exception 'TESTE FALHOU [T1]: custo_unitario errado (%), esperava %', v_custo_unit, public.arredondar_moeda(8.4 * v_fator);
  end if;
  if v_custo_total <> public.arredondar_moeda(v_custo_unit * 3) then
    raise exception 'TESTE FALHOU [T1]: custo_total errado (%)', v_custo_total;
  end if;
  if v_status <> 'em_aberto' or v_pago_em is not null then
    raise exception 'TESTE FALHOU [T1]: deveria nascer em_aberto sem pago_em';
  end if;
  select quantidade, custo_unitario into v_n, v_custo_unit from public.estoque_movimentos where id = v_mov;
  if v_n <> 3 or v_custo_unit <> (select custo_unitario from public.varejo_dividas_atacado where id = v_divida) then
    raise exception 'TESTE FALHOU [T1]: entrada de estoque nao bate com a divida';
  end if;
  select count(*) into v_n from public.audit_log where tabela = 'varejo_dividas_atacado' and registro_id = v_divida and acao = 'criacao';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: criacao da divida nao foi auditada'; end if;

  -- T2. Compra ja paga (status explicito) -> pago_em preenchido na hora
  v_divida2 := public.registrar_compra_atacado_varejo(v_var, v_dep, 10, 1, 'pago', 'teste pago direto');
  select status, pago_em into v_status, v_pago_em from public.varejo_dividas_atacado where id = v_divida2;
  if v_status <> 'pago' or v_pago_em is null then
    raise exception 'TESTE FALHOU [T2]: status pago deveria vir com pago_em preenchido';
  end if;

  -- T3. Marcar como paga depois (update direto, mesmo caminho da tela) -> audita edicao
  update public.varejo_dividas_atacado set status = 'pago', pago_em = now() where id = v_divida;
  select count(*) into v_n from public.audit_log where tabela = 'varejo_dividas_atacado' and registro_id = v_divida and acao = 'edicao';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: marcar como paga nao foi auditado'; end if;

  -- T4. Codigo <= 0 e quantidade <= 0 sao rejeitados
  begin
    perform public.registrar_compra_atacado_varejo(v_var, v_dep, 0, 1);
    raise exception 'TESTE FALHOU [T4]: codigo zero deveria falhar';
  exception when others then
    if sqlerrm not like '%codigo%' then raise exception 'TESTE FALHOU [T4]: erro inesperado: %', sqlerrm; end if;
  end;
  begin
    perform public.registrar_compra_atacado_varejo(v_var, v_dep, 8.4, 0);
    raise exception 'TESTE FALHOU [T4]: quantidade zero deveria falhar';
  exception when others then
    if sqlerrm not like '%Quantidade%' then raise exception 'TESTE FALHOU [T4]: erro inesperado: %', sqlerrm; end if;
  end;

  -- T5. Status invalido e rejeitado
  begin
    perform public.registrar_compra_atacado_varejo(v_var, v_dep, 8.4, 1, 'quitado');
    raise exception 'TESTE FALHOU [T5]: status invalido deveria falhar';
  exception when others then
    if sqlerrm not like '%Status invalido%' then raise exception 'TESTE FALHOU [T5]: erro inesperado: %', sqlerrm; end if;
  end;

  -- T6. So ATACADO -> recusado (modulo e so do Varejo, mesma trava das outras 6 tabelas)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_atacado))::text, true);
  begin
    perform public.registrar_compra_atacado_varejo(v_var, v_dep, 8.4, 1);
    raise exception 'TESTE FALHOU [T6]: deveria ser recusado fora da operacao VAREJO';
  exception when others then
    if sqlerrm not like '%VAREJO%' then raise exception 'TESTE FALHOU [T6]: erro inesperado: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);

  -- T7. Papel estoque nao pode registrar compra (so admin -- custo/divida e informacao financeira)
  if v_estoque is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_estoque, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    begin
      perform public.registrar_compra_atacado_varejo(v_var, v_dep, 8.4, 1);
      raise exception 'TESTE FALHOU [T7]: papel estoque conseguiu registrar compra do Atacado';
    exception when others then
      if sqlerrm not like '%permiss%' then raise exception 'TESTE FALHOU [T7]: erro inesperado: %', sqlerrm; end if;
    end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T7 pulado: nenhum profile com papel estoque encontrado.';
  end if;

  -- T8. Vendedor nao enxerga nem escreve na tabela (RLS admin-only, igual as outras 6)
  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    select count(*) into v_n from public.varejo_dividas_atacado;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T8]: vendedor enxergou % linha(s) de varejo_dividas_atacado (deveria ser 0)', v_n; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T8 pulado: nenhum profile com papel vendedor encontrado.';
  end if;

  -- Nao precisa limpar nada aqui: a transacao inteira do ensaio e desfeita no final ($cmp$ sempre
  -- aborta de proposito).

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T8 (calculo de custo, entrada de estoque amarrada, auditoria, validacoes, isolamento VAREJO/admin).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop table if exists public.varejo_dividas_atacado cascade;
  drop function if exists public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text);
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
       where t.table_schema = 'public' and t.table_name = 'varejo_dividas_atacado'
      union all
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname = 'registrar_compra_atacado_varejo'
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

  raise exception 'ENSAIO OK: divida com o Atacado por cadastro direto no Varejo (tabela + function registrar_compra_atacado_varejo), testado (T1 a T8) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
