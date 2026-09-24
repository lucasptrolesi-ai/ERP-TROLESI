-- Corrige 2 achados de seguranca das pendencias decididas na Central do Admin (functions_definer_sem_guarda):
-- conceder_permissao/revogar_permissao nao respeitavam operacao, e pedido_tem_registro_financeiro nao
-- tinha guarda de operacao nenhuma.
-- Pre-requisito: etapa 1 (operacao_id + carimbar_operacao/travar_operacao ja existem em permissoes_usuario).
--
-- O QUE FAZ (uma transacao so):
--   1. permissoes_usuario: a unicidade era (profile_id, permissao) GLOBAL -- impossivel conceder a
--      mesma permissao especial pro mesmo usuario em duas operacoes diferentes (a segunda tentativa
--      virava "on conflict do nothing" silencioso). Troca pra (profile_id, permissao, operacao_id).
--   2. conceder_permissao: ON CONFLICT ajustado pra nova chave.
--   3. revogar_permissao: o DELETE ganhou "and operacao_id = operacao_atual()" -- antes removia a
--      permissao em TODAS as operacoes de uma vez.
--   4. pedido_tem_registro_financeiro: as duas consultas (contas_receber, pedido_pagamentos_mistos)
--      ganharam "and operacao_id = operacao_atual()" -- antes respondia sobre pedido de QUALQUER
--      operacao, nao so a atual (function nao tem uso no codigo hoje, achado teorico, mas corrigido
--      pra nao virar problema se alguem chamar via RPC direto).
--
-- Nao mexe nas outras 7 tabelas com unicidade global mencionadas em unicidades_por_operacao
-- (clientes.cpf_cnpj, produtos.codigo_interno, fornecedores.cnpj, condicoes_pagamento.forma_pagamento,
-- faixas_parcelamento, vendedores.profile_id, cupons_evento.codigo) -- essa e uma decisao maior,
-- registrada como nao-prioridade agora (bloco "modernizar o atacado").
--
-- COMO RODAR: igual as migrations anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve a unicidade e
-- -- as functions ao estado anterior, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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

-- md5 sobre o prosrc com espacos em branco normalizados: o DO $down$ recria as 3 functions com a
-- indentacao aninhada desta migration, nao byte-a-byte igual ao original -- funcionalmente identico,
-- so a formatacao muda, e isso nao pode contar como "rollback incompleto".
create temp table _fp_antes on commit drop as
  select 'T ' || c.relname || ' ' || c.relkind::text as item
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
  union all
  select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('conceder_permissao', 'revogar_permissao', 'pedido_tem_registro_financeiro');

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'permissoes_usuario_profile_id_permissao_key') then
    raise exception 'ABORTADO: parece ja aplicada (unicidade antiga ja nao existe).';
  end if;

  -- 1. Unicidade de permissoes_usuario passa a incluir operacao_id -----------------------------------
  alter table public.permissoes_usuario drop constraint permissoes_usuario_profile_id_permissao_key;
  alter table public.permissoes_usuario
    add constraint permissoes_usuario_profile_id_permissao_operacao_key unique (profile_id, permissao, operacao_id);

  -- 2. conceder_permissao: ON CONFLICT pra nova chave -------------------------------------------------
  create or replace function public.conceder_permissao(p_profile_id uuid, p_permissao permissao_especial) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);

    if not exists (select 1 from public.profiles where id = p_profile_id) then
      raise exception 'Usuário não encontrado.';
    end if;

    insert into public.permissoes_usuario (profile_id, permissao, concedida_por)
    values (p_profile_id, p_permissao, auth.uid())
    on conflict (profile_id, permissao, operacao_id) do nothing;

    perform public.registrar_auditoria(
      'permissoes_usuario', p_profile_id, 'conceder_permissao',
      null, jsonb_build_object('permissao', p_permissao), null
    );
  end;
  $fn$;

  -- 3. revogar_permissao: so na operacao atual -----------------------------------------------------
  create or replace function public.revogar_permissao(p_profile_id uuid, p_permissao permissao_especial) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);

    delete from public.permissoes_usuario
      where profile_id = p_profile_id and permissao = p_permissao and operacao_id = public.operacao_atual();

    perform public.registrar_auditoria(
      'permissoes_usuario', p_profile_id, 'revogar_permissao',
      jsonb_build_object('permissao', p_permissao), null, null
    );
  end;
  $fn$;

  -- 4. pedido_tem_registro_financeiro: so olha a operacao atual -----------------------------------------
  create or replace function public.pedido_tem_registro_financeiro(p_pedido_id uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select exists(select 1 from public.contas_receber where pedido_id = p_pedido_id and operacao_id = public.operacao_atual())
        or exists(select 1 from public.pedido_pagamentos_mistos where pedido_id = p_pedido_id and operacao_id = public.operacao_atual());
  $fn$;
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

  if not exists (select 1 from pg_constraint where conname = 'permissoes_usuario_profile_id_permissao_operacao_key') then
    raise exception 'FALHA: unicidade nova nao foi criada';
  end if;
  if exists (select 1 from pg_constraint where conname = 'permissoes_usuario_profile_id_permissao_key') then
    raise exception 'FALHA: unicidade antiga ainda existe';
  end if;

  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('conceder_permissao', 'revogar_permissao', 'pedido_tem_registro_financeiro');
  if v_n <> 3 then raise exception 'FALHA: functions = %, esperado 3', v_n; end if;

  raise notice 'VERIFICACAO OK: unicidade e as 3 functions corrigidas.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_pedido uuid;
  v_n bigint;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  delete from public.permissoes_usuario where profile_id = v_barbara and permissao = 'informar_cotacao';

  -- T1. Conceder a mesma permissao pra Barbara em ATACADO e depois em VAREJO -- as duas devem existir
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.conceder_permissao(v_barbara, 'informar_cotacao');
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  perform public.conceder_permissao(v_barbara, 'informar_cotacao');
  execute 'reset role';

  select count(*) into v_n from public.permissoes_usuario where profile_id = v_barbara and permissao = 'informar_cotacao';
  if v_n <> 2 then raise exception 'TESTE FALHOU [T1]: permissao concedida em 2 operacoes = %, esperado 2 (antes, a segunda virava no-op)', v_n; end if;

  -- T2. Revogar em VAREJO nao afeta a concessao em ATACADO
  execute 'set local role authenticated';
  perform public.revogar_permissao(v_barbara, 'informar_cotacao');
  execute 'reset role';
  select count(*) into v_n from public.permissoes_usuario
   where profile_id = v_barbara and permissao = 'informar_cotacao' and operacao_id = v_varejo;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T2]: revogar em VAREJO nao removeu a permissao de VAREJO'; end if;
  select count(*) into v_n from public.permissoes_usuario
   where profile_id = v_barbara and permissao = 'informar_cotacao' and operacao_id = v_atacado;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: revogar em VAREJO removeu tambem a permissao do ATACADO (bug antigo)'; end if;

  -- T3. pedido_tem_registro_financeiro: contexto VAREJO nao ve registro financeiro de pedido do ATACADO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select id into v_pedido from public.pedidos where operacao_id = v_atacado limit 1;
  if v_pedido is not null then
    insert into public.contas_receber (cliente_id, pedido_id, valor, vencimento)
    select cliente_id, v_pedido, 1, current_date + 30 from public.pedidos where id = v_pedido;
  end if;
  execute 'reset role';

  if v_pedido is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if not public.pedido_tem_registro_financeiro(v_pedido) then
      raise exception 'TESTE FALHOU [T3]: nao encontrou o registro financeiro no proprio contexto (ATACADO)';
    end if;
    execute 'reset role';

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    execute 'set local role authenticated';
    if public.pedido_tem_registro_financeiro(v_pedido) then
      raise exception 'TESTE FALHOU [T3]: contexto VAREJO enxergou registro financeiro do ATACADO';
    end if;
    execute 'reset role';
  else
    raise notice 'T3 pulado: nenhum pedido do atacado encontrado pra testar';
  end if;

  delete from public.permissoes_usuario where profile_id = v_barbara and permissao = 'informar_cotacao';
  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T3 (permissao por operacao, revogar isolado, guarda de operacao na consulta financeira).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  alter table public.permissoes_usuario drop constraint if exists permissoes_usuario_profile_id_permissao_operacao_key;
  alter table public.permissoes_usuario add constraint permissoes_usuario_profile_id_permissao_key unique (profile_id, permissao);

  create or replace function public.conceder_permissao(p_profile_id uuid, p_permissao permissao_especial) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);

    if not exists (select 1 from public.profiles where id = p_profile_id) then
      raise exception 'Usuário não encontrado.';
    end if;

    insert into public.permissoes_usuario (profile_id, permissao, concedida_por)
    values (p_profile_id, p_permissao, auth.uid())
    on conflict (profile_id, permissao) do nothing;

    perform public.registrar_auditoria(
      'permissoes_usuario', p_profile_id, 'conceder_permissao',
      null, jsonb_build_object('permissao', p_permissao), null
    );
  end;
  $fn$;

  create or replace function public.revogar_permissao(p_profile_id uuid, p_permissao permissao_especial) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);

    delete from public.permissoes_usuario
      where profile_id = p_profile_id and permissao = p_permissao;

    perform public.registrar_auditoria(
      'permissoes_usuario', p_profile_id, 'revogar_permissao',
      jsonb_build_object('permissao', p_permissao), null, null
    );
  end;
  $fn$;

  create or replace function public.pedido_tem_registro_financeiro(p_pedido_id uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select exists(select 1 from public.contas_receber where pedido_id = p_pedido_id)
        or exists(select 1 from public.pedido_pagamentos_mistos where pedido_id = p_pedido_id);
  $fn$;
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
    select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      from pg_constraint where connamespace = 'public'::regnamespace
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('conceder_permissao', 'revogar_permissao', 'pedido_tem_registro_financeiro');

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: permissoes por operacao e guarda de pedido_tem_registro_financeiro aplicadas, verificadas, testadas (T1 a T3) e desfeitas identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
