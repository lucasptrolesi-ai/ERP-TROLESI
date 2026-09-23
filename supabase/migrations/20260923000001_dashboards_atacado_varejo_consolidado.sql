-- Dashboards com gráfico: funções de relatório pra Atacado, Varejo e Consolidado.
-- Pre-requisito: etapas 1 a 5c aplicadas (varejo completo) e o schema original do atacado.
--
-- O QUE FAZ (uma transacao so): cria 3 functions SOMENTE LEITURA, admin-only, que devolvem jsonb
-- pronto pra virar gráfico no front (faturamento por período, formas de pagamento, produtos mais
-- vendidos, contas a receber/pagar em aberto):
--   1. relatorio_atacado_dashboard(p_meses): agrega pedidos/pedido_itens do ATACADO. Exige contexto
--      ATACADO (mesmo padrao das outras functions do atacado que cruzam operacao).
--   2. relatorio_varejo_dashboard(p_dias): agrega vendas/venda_itens/venda_pagamentos/caixa_sessoes
--      do VAREJO. Exige contexto VAREJO.
--   3. relatorio_consolidado_mensal(p_meses): atacado x varejo lado a lado, mes a mes -- companheira
--      da relatorio_consolidado() que ja existe (etapa 5b), que devolve so o total de UM periodo.
--      Nao exige nenhuma operacao especifica (como relatorio_consolidado, cruza as duas de proposito).
--
-- Risco baixo (funcoes STABLE, sem escrita nenhuma) -- os testes cobrem o essencial: admin-only,
-- guarda de operacao, e os numeros batendo com uma agregacao equivalente feita na mao.
--
-- COMO RODAR: igual as migrations anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo tem o DROP exato
-- -- pra cada CREATE, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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
  select 'T ' || c.relname || ' ' || c.relkind::text as item
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
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

  if to_regprocedure('public.relatorio_atacado_dashboard(integer)') is not null then
    raise exception 'ABORTADO: parece ja aplicada (relatorio_atacado_dashboard existe).';
  end if;
  if to_regprocedure('public.relatorio_consolidado(date, date)') is null then
    raise exception 'ABORTADO: etapa 5b nao aplicada (relatorio_consolidado ausente).';
  end if;

  -- 1. Atacado ------------------------------------------------------------------------------------
  create or replace function public.relatorio_atacado_dashboard(p_meses integer default 6) returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_op uuid;
    v_res jsonb;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('ATACADO');
    v_op := public.operacao_atual();
    if p_meses is null or p_meses < 1 or p_meses > 24 then
      raise exception 'Periodo invalido';
    end if;

    select jsonb_build_object(
      'faturamento_mensal', coalesce((
        select jsonb_agg(jsonb_build_object('mes', mes, 'total', total, 'pedidos', pedidos) order by mes)
        from (
          select to_char(date_trunc('month', p.criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM') as mes,
                 sum(p.total) as total, count(*) as pedidos
            from public.pedidos p
           where p.operacao_id = v_op and p.status = 'faturado'
             and p.criado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') - (p_meses - 1) * interval '1 month'
           group by 1
        ) m
      ), '[]'::jsonb),
      'formas_pagamento', coalesce((
        select jsonb_agg(jsonb_build_object('forma', forma_pagamento, 'total', total, 'qtd', qtd) order by total desc)
        from (
          select p.forma_pagamento, sum(p.total) as total, count(*) as qtd
            from public.pedidos p
           where p.operacao_id = v_op and p.status = 'faturado' and p.forma_pagamento is not null
           group by 1
        ) f
      ), '[]'::jsonb),
      'top_produtos', coalesce((
        select jsonb_agg(jsonb_build_object('nome', nome, 'total', total, 'quantidade', quantidade) order by total desc)
        from (
          select pr.nome, sum(pi.quantidade * pi.preco_unitario) as total, sum(pi.quantidade) as quantidade
            from public.pedido_itens pi
            join public.pedidos p on p.id = pi.pedido_id
            join public.produtos pr on pr.id = pi.produto_id
           where p.operacao_id = v_op and p.status = 'faturado'
           group by pr.nome
           order by total desc limit 8
        ) t
      ), '[]'::jsonb),
      'receber_aberto', (select coalesce(sum(valor), 0) from public.contas_receber where operacao_id = v_op and situacao <> 'pago'),
      'pagar_aberto', (select coalesce(sum(valor), 0) from public.contas_pagar where operacao_id = v_op and situacao <> 'pago')
    ) into v_res;

    return v_res;
  end
  $fn$;
  revoke execute on function public.relatorio_atacado_dashboard(integer) from public, anon, authenticated;
  grant execute on function public.relatorio_atacado_dashboard(integer) to authenticated;

  -- 2. Varejo ---------------------------------------------------------------------------------------
  create or replace function public.relatorio_varejo_dashboard(p_dias integer default 14) returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_op uuid;
    v_res jsonb;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    v_op := public.operacao_atual();
    if p_dias is null or p_dias < 1 or p_dias > 90 then
      raise exception 'Periodo invalido';
    end if;

    select jsonb_build_object(
      'faturamento_diario', coalesce((
        select jsonb_agg(jsonb_build_object('dia', dia, 'total', total, 'vendas', vendas) order by dia)
        from (
          select (v.criada_em at time zone 'America/Sao_Paulo')::date as dia, sum(v.total) as total, count(*) as vendas
            from public.vendas v
           where v.operacao_id = v_op and v.status = 'concluida'
             and v.criada_em >= now() - (p_dias || ' days')::interval
           group by 1
        ) d
      ), '[]'::jsonb),
      'formas_pagamento', coalesce((
        select jsonb_agg(jsonb_build_object('forma', forma, 'total', total, 'qtd', qtd) order by total desc)
        from (
          select vp.forma, sum(vp.valor) as total, count(*) as qtd
            from public.venda_pagamentos vp
            join public.vendas v on v.id = vp.venda_id and v.operacao_id = vp.operacao_id
           where vp.operacao_id = v_op and v.status = 'concluida'
           group by vp.forma
        ) f
      ), '[]'::jsonb),
      'top_produtos', coalesce((
        select jsonb_agg(jsonb_build_object('nome', nome, 'total', total, 'quantidade', quantidade) order by total desc)
        from (
          select cp.nome, sum(i.quantidade * i.preco_unitario) as total, sum(i.quantidade) as quantidade
            from public.venda_itens i
            join public.vendas v on v.id = i.venda_id and v.operacao_id = i.operacao_id
            join public.catalogo_variacoes cv on cv.id = i.variacao_id and cv.operacao_id = i.operacao_id
            join public.catalogo_produtos cp on cp.id = cv.produto_id and cp.operacao_id = cv.operacao_id
           where i.operacao_id = v_op and v.status = 'concluida'
           group by cp.nome
           order by total desc limit 8
        ) t
      ), '[]'::jsonb),
      'receber_aberto', (select coalesce(sum(valor), 0) from public.contas_receber where operacao_id = v_op and situacao <> 'pago'),
      'pagar_aberto', (select coalesce(sum(valor), 0) from public.contas_pagar where operacao_id = v_op and situacao <> 'pago'),
      'sessoes_periodo', (select count(*) from public.caixa_sessoes where operacao_id = v_op and aberta_em >= now() - (p_dias || ' days')::interval),
      'divergencia_total', (select coalesce(sum(abs(divergencia)), 0) from public.caixa_sessoes
                              where operacao_id = v_op and status = 'fechada' and fechada_em >= now() - (p_dias || ' days')::interval)
    ) into v_res;

    return v_res;
  end
  $fn$;
  revoke execute on function public.relatorio_varejo_dashboard(integer) from public, anon, authenticated;
  grant execute on function public.relatorio_varejo_dashboard(integer) to authenticated;

  -- 3. Consolidado, mes a mes (a relatorio_consolidado ja existente cobre so um periodo por vez) ----
  create or replace function public.relatorio_consolidado_mensal(p_meses integer default 6) returns jsonb
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_res jsonb;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    if p_meses is null or p_meses < 1 or p_meses > 24 then
      raise exception 'Periodo invalido';
    end if;

    with meses as (
      select to_char(d, 'YYYY-MM') as mes
        from generate_series(
          date_trunc('month', now() at time zone 'America/Sao_Paulo') - (p_meses - 1) * interval '1 month',
          date_trunc('month', now() at time zone 'America/Sao_Paulo'), interval '1 month') d
    ),
    atacado as (
      select to_char(date_trunc('month', p.criado_em at time zone 'America/Sao_Paulo'), 'YYYY-MM') as mes, sum(p.total) as total
        from public.pedidos p
       where p.operacao_id = (select id from public.operacoes where codigo = 'ATACADO') and p.status = 'faturado'
       group by 1
    ),
    varejo as (
      select to_char(date_trunc('month', v.criada_em at time zone 'America/Sao_Paulo'), 'YYYY-MM') as mes, sum(v.total) as total
        from public.vendas v
       where v.operacao_id = (select id from public.operacoes where codigo = 'VAREJO') and v.status = 'concluida'
       group by 1
    )
    select jsonb_build_object(
      'meses', coalesce(jsonb_agg(jsonb_build_object(
        'mes', m.mes, 'atacado', coalesce(a.total, 0), 'varejo', coalesce(vj.total, 0)
      ) order by m.mes), '[]'::jsonb)
    ) into v_res
    from meses m
    left join atacado a on a.mes = m.mes
    left join varejo vj on vj.mes = m.mes;

    return v_res;
  end
  $fn$;
  revoke execute on function public.relatorio_consolidado_mensal(integer) from public, anon, authenticated;
  grant execute on function public.relatorio_consolidado_mensal(integer) to authenticated;
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
   where routine_schema = 'public'
     and routine_name in ('relatorio_atacado_dashboard', 'relatorio_varejo_dashboard', 'relatorio_consolidado_mensal');
  if v_n <> 3 then raise exception 'FALHA: funcoes novas = %, esperado 3', v_n; end if;

  raise notice 'VERIFICACAO OK: 3 funcoes de dashboard criadas.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_dep uuid;
  v_prod uuid;
  v_var uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_operador_sessao uuid;
  v_res jsonb;
  v_esperado numeric;
  v_calculado numeric;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_caixa from public.caixas where operacao_id = v_varejo and nome = 'CAIXA 1';

  -- T1. Vendedora nao acessa nenhuma das 3 functions
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.relatorio_atacado_dashboard(6);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: vendedora acessou relatorio_atacado_dashboard'; end if;
  execute 'reset role';

  -- T2. Admin em contexto ATACADO: relatorio_atacado_dashboard bate com agregacao feita na mao
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.relatorio_atacado_dashboard(12);
  execute 'reset role';

  select coalesce(sum(p.total), 0) into v_esperado
    from public.pedidos p where p.operacao_id = v_atacado and p.status = 'faturado';
  select coalesce(sum((m.value ->> 'total')::numeric), 0) into v_calculado
    from jsonb_array_elements(v_res -> 'faturamento_mensal') m
   where (m.value ->> 'mes') >= to_char(now() - interval '12 months', 'YYYY-MM');
  if abs(v_calculado - v_esperado) > 0.01 then
    raise exception 'TESTE FALHOU [T2]: faturamento mensal somado = %, esperado % (agregacao direta)', v_calculado, v_esperado;
  end if;
  if (v_res ->> 'pagar_aberto') is null or (v_res ->> 'receber_aberto') is null then
    raise exception 'TESTE FALHOU [T2]: receber_aberto/pagar_aberto ausentes';
  end if;

  -- T3. Admin em contexto VAREJO nao acessa a function do atacado (guarda de operacao)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.relatorio_atacado_dashboard(6);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T3]: contexto VAREJO acessou relatorio_atacado_dashboard'; end if;

  -- T4. relatorio_varejo_dashboard: cria uma venda sintetica e confere que aparece no relatorio
  insert into public.catalogo_produtos (nome, categoria) values ('ZZ ENSAIO DASH', 'ANEL') returning id into v_prod;
  insert into public.catalogo_variacoes (produto_id, sku, preco_venda) values (v_prod, 'ZZDASH-1', 200.00) returning id into v_var;
  execute 'set constraints all immediate';
  select c.deposito_id into v_dep from public.caixas c where c.id = v_caixa;
  perform public.registrar_entrada_estoque(v_dep, v_var, 5, 80.00, 'ensaio dashboard');

  -- Reaproveita uma sessao de caixa ja aberta de verdade (do uso real do sistema) em vez de tentar
  -- abrir outra -- abrir_sessao_caixa so permite uma aberta por caixa e por operador. Se a sessao
  -- aberta for de outro operador, registra a venda de teste como esse mesmo operador (dono dela).
  select id, operador_id into v_sessao, v_operador_sessao
    from public.caixa_sessoes where operacao_id = v_varejo and status = 'aberta' limit 1;
  if v_sessao is null then
    v_sessao := public.abrir_sessao_caixa(v_caixa, 50);
  elsif v_operador_sessao <> v_lucas then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_operador_sessao, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;

  perform public.registrar_venda(v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 200)));

  v_res := public.relatorio_varejo_dashboard(1);
  select coalesce(sum((d.value ->> 'total')::numeric), 0) into v_calculado from jsonb_array_elements(v_res -> 'faturamento_diario') d;
  if v_calculado < 200 then raise exception 'TESTE FALHOU [T4]: faturamento_diario nao capturou a venda sintetica (achou %)', v_calculado; end if;
  select coalesce(sum((f.value ->> 'total')::numeric), 0) into v_calculado
    from jsonb_array_elements(v_res -> 'formas_pagamento') f where f.value ->> 'forma' = 'pix';
  if v_calculado < 200 then raise exception 'TESTE FALHOU [T4]: formas_pagamento nao capturou o pix da venda sintetica'; end if;
  if not exists (select 1 from jsonb_array_elements(v_res -> 'top_produtos') t where t.value ->> 'nome' = 'ZZ ENSAIO DASH') then
    raise exception 'TESTE FALHOU [T4]: top_produtos nao capturou o produto sintetico';
  end if;
  execute 'reset role';

  -- T5. relatorio_consolidado_mensal: mes atual tem o atacado e o varejo somados corretamente
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.relatorio_consolidado_mensal(1);
  execute 'reset role';
  select coalesce((m.value ->> 'varejo')::numeric, 0) into v_calculado
    from jsonb_array_elements(v_res -> 'meses') m where m.value ->> 'mes' = to_char(now(), 'YYYY-MM');
  if v_calculado < 200 then raise exception 'TESTE FALHOU [T5]: mes atual do consolidado nao inclui a venda sintetica do varejo (achou %)', v_calculado; end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T5 (admin-only, guarda de operacao, numeros batendo com agregacao direta).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.relatorio_consolidado_mensal(integer);
  drop function if exists public.relatorio_varejo_dashboard(integer);
  drop function if exists public.relatorio_atacado_dashboard(integer);
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

  raise exception 'ENSAIO OK: dashboards aplicados, verificados, testados (T1 a T5) e desfeitos com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
