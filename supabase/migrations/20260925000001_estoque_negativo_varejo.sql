-- Resolve a pendencia "estoque_varejo_sem_saldo_negativo": hoje o PDV Varejo recusa SEMPRE vender
-- mais do que o saldo em sistema mostra. Decisao do usuario: permitir, igual ja acontece no
-- Atacado -- mas com autorizacao de supervisor (o Atacado nao pede nada porque nao tem PIN; o
-- Varejo ja tem o mecanismo de autorizacao pontual usado em desconto_abaixo_piso/cancelamento/
-- estorno, entao a venda com saldo negativo usa o mesmo caminho).
-- Pre-requisito: etapa 20260921000004 (autorizacoes_pontuais, autorizar_acao, consumir_autorizacao),
-- etapa 20260921000005 (registrar_venda).
--
-- O QUE FAZ (uma transacao so):
--   1. autorizacoes_pontuais.acao (CHECK) e a lista aceita por autorizar_acao() ganham
--      'estoque_negativo'.
--   2. registrar_venda() ganha p_autorizacao_estoque_id (ultimo parametro, default null -- toda
--      chamada existente continua funcionando sem mudar nada). Item com saldo insuficiente nao
--      bloqueia mais na hora: fica acumulado; ao final da venda, se sobrou item sem saldo
--      suficiente E nao veio autorizacao valida, RAISE EXCEPTION (mesmo bloqueio de hoje,
--      preservado -- so muda com autorizacao explicita). Com autorizacao valida, a venda completa
--      com saldo negativo e fica auditada (quais itens, saldo, quantidade pedida, quem autorizou).
--
-- Nao mexe no bloqueio de UI que hoje impede clicar pra adicionar item com saldo <= 0 ao carrinho
-- nem no fluxo de PIN da tela -- isso e ajuste de front-end (src/app/(app)/varejo/pdv), feito
-- junto no mesmo commit desta migration, fora do escopo do que roda no SQL Editor.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve a
-- -- constraint e as duas functions ao estado anterior, testado pelo proprio modo 'ensaio' antes
-- -- de chegar aqui):
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
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('registrar_venda', 'autorizar_acao')
    union all
    select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
    union all
    select 'C ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      from pg_constraint c where c.conrelid = 'public.autorizacoes_pontuais'::regclass and c.contype = 'c'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  alter table public.autorizacoes_pontuais drop constraint autorizacoes_pontuais_acao_check;
  alter table public.autorizacoes_pontuais add constraint autorizacoes_pontuais_acao_check
    check (acao in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo'));

  create or replace function public.autorizar_acao(p_supervisor_id uuid, p_pin text, p_acao text, p_alvo_id uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_sv public.supervisores%rowtype;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    if v_op is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    if p_acao not in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo') then
      raise exception 'Acao nao suportada';
    end if;
    if p_supervisor_id = auth.uid() then
      return jsonb_build_object('ok', false, 'motivo', 'auto_autorizacao');
    end if;
    select * into v_sv from public.supervisores
     where profile_id = p_supervisor_id and operacao_id = v_op and ativo for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'supervisor_invalido');
    end if;
    if v_sv.bloqueado_ate is not null and v_sv.bloqueado_ate > now() then
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
    end if;
    if p_pin is null or v_sv.pin_hash <> extensions.crypt(p_pin, v_sv.pin_hash) then
      update public.supervisores
         set tentativas_falhas = tentativas_falhas + 1,
             bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes' else bloqueado_ate end,
             atualizado_em = now()
       where profile_id = p_supervisor_id and operacao_id = v_op;
      perform public.registrar_auditoria('supervisores', p_supervisor_id, 'pin_supervisor_falhou', null,
        jsonb_build_object('acao', p_acao), null);
      return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
    end if;
    update public.supervisores set tentativas_falhas = 0, bloqueado_ate = null, atualizado_em = now()
     where profile_id = p_supervisor_id and operacao_id = v_op;
    insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
    values (p_acao, p_supervisor_id, auth.uid(), p_alvo_id, now() + interval '5 minutes')
    returning id into v_id;
    perform public.registrar_auditoria('autorizacoes_pontuais', v_id, 'autorizacao_concedida', null,
      jsonb_build_object('acao', p_acao, 'supervisor_id', p_supervisor_id, 'alvo_id', p_alvo_id), null);
    return jsonb_build_object('ok', true, 'autorizacao_id', v_id);
  end
  $fn$;

  -- CREATE OR REPLACE nao troca a function quando a lista de parametros muda (mesmo so acrescentando
  -- um com default) -- o Postgres identifica a function pelos TIPOS dos parametros, entao ficaria uma
  -- SEGUNDA versao sobrecarregada ao lado da antiga, e toda chamada existente (sem o parametro novo)
  -- viraria ambigua pro PostgREST. Precisa derrubar a assinatura antiga primeiro.
  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid);

  create or replace function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null,
    p_cliente_nome text default null, p_cliente_documento text default null, p_autorizacao_desconto_id uuid default null,
    p_autorizacao_estoque_id uuid default null
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_s public.caixa_sessoes%rowtype;
    v_dep uuid;
    v_id uuid;
    v_numero bigint;
    v_item jsonb;
    v_pag jsonb;
    v_var uuid;
    v_qtd integer;
    v_tab numeric;
    v_min numeric;
    v_piso numeric;
    v_prat numeric;
    v_custo numeric;
    v_saldo bigint;
    v_subtotal numeric := 0;
    v_total numeric := 0;
    v_abaixo jsonb := '[]'::jsonb;
    v_estoque_insuf jsonb := '[]'::jsonb;
    v_sup uuid;
    v_sup_estoque uuid;
    v_forma text;
    v_valor numeric;
    v_parc integer;
    v_soma numeric := 0;
    v_dinheiro numeric := 0;
    v_troco numeric;
    v_mov uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    if p_idempotency_key is not null then
      select v.id into v_id from public.vendas v where v.operacao_id = v_op and v.idempotency_key = p_idempotency_key;
      if found then
        return v_id;
      end if;
    end if;

    select * into v_s from public.caixa_sessoes where id = p_sessao_id and operacao_id = v_op for update;
    if not found or v_s.status <> 'aberta' then
      raise exception 'Sessao de caixa nao encontrada ou ja fechada';
    end if;
    if v_s.operador_id <> auth.uid() then
      raise exception 'A sessao de caixa pertence a outro operador';
    end if;
    select c.deposito_id into v_dep from public.caixas c where c.id = v_s.caixa_id and c.operacao_id = v_op;
    if v_dep is null then
      raise exception 'Caixa sem deposito de estoque configurado';
    end if;
    if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
      raise exception 'A venda precisa de ao menos um item';
    end if;
    if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array' or jsonb_array_length(p_pagamentos) = 0 then
      raise exception 'A venda precisa de ao menos um pagamento';
    end if;

    v_numero := public.proximo_numero_operacao('venda');
    insert into public.vendas (numero, sessao_id, deposito_id, operador_id, cliente_nome, cliente_documento, idempotency_key)
    values (v_numero, p_sessao_id, v_dep, auth.uid(), nullif(trim(p_cliente_nome), ''), nullif(trim(p_cliente_documento), ''), p_idempotency_key)
    returning id into v_id;

    for v_item in select e from jsonb_array_elements(p_itens) e loop
      v_var := (v_item ->> 'variacao_id')::uuid;
      v_qtd := (v_item ->> 'quantidade')::integer;
      if v_qtd is null or v_qtd <= 0 then
        raise exception 'Quantidade invalida';
      end if;
      select cv.preco_venda, cv.preco_minimo into v_tab, v_min
        from public.catalogo_variacoes cv
       where cv.id = v_var and cv.operacao_id = v_op and cv.ativo;
      if not found then
        raise exception 'Variacao nao encontrada ou inativa';
      end if;
      -- O preco vem do catalogo; o cliente so pode pedir um preco MENOR (desconto).
      v_prat := coalesce(public.arredondar_moeda(nullif(v_item ->> 'preco_unitario', '')::numeric), v_tab);
      if v_prat < 0 or v_prat > v_tab then
        raise exception 'Preco praticado invalido (maximo: preco de tabela)';
      end if;
      v_piso := coalesce(v_min, v_tab);
      if v_prat < v_piso then
        v_abaixo := v_abaixo || jsonb_build_object('variacao_id', v_var, 'preco_tabela', v_tab, 'piso', v_piso, 'preco_praticado', v_prat);
      end if;

      select coalesce(sum(m.quantidade), 0) into v_saldo from public.estoque_movimentos m
       where m.variacao_id = v_var and m.deposito_id = v_dep and m.operacao_id = v_op;
      if v_saldo < v_qtd then
        -- Estoque negativo autorizado (pendencia estoque_varejo_sem_saldo_negativo, decidido
        -- 2026-09-25): nao bloqueia mais aqui na hora -- acumula, e so exige autorizacao de
        -- supervisor depois do loop (mesmo padrao de desconto_abaixo_piso, logo abaixo).
        v_estoque_insuf := v_estoque_insuf || jsonb_build_object('variacao_id', v_var, 'saldo', v_saldo, 'quantidade_pedida', v_qtd);
      end if;
      v_custo := public.custo_medio_variacao(v_var);
      if v_custo is null then
        raise exception 'Variacao sem custo conhecido: registre uma entrada de estoque';
      end if;

      insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, documento_tipo, documento_id, criado_por)
      values (v_dep, v_var, 'venda', -v_qtd, v_custo, 'venda', v_id, auth.uid());
      -- Custo congelado no fato: a linha da venda recebe a COPIA do custo gravado no movimento.
      insert into public.venda_itens (venda_id, variacao_id, quantidade, preco_tabela, preco_unitario, custo_unitario)
      values (v_id, v_var, v_qtd, v_tab, v_prat, v_custo);

      v_subtotal := v_subtotal + public.arredondar_moeda(v_tab * v_qtd);
      v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);
    end loop;

    if jsonb_array_length(v_estoque_insuf) > 0 then
      if p_autorizacao_estoque_id is null then
        raise exception 'Estoque insuficiente em % item(ns) do carrinho -- exige autorizacao de supervisor', jsonb_array_length(v_estoque_insuf);
      end if;
      v_sup_estoque := public.consumir_autorizacao(p_autorizacao_estoque_id, 'estoque_negativo', p_sessao_id);
      perform public.registrar_auditoria('vendas', v_id, 'estoque_negativo', null,
        jsonb_build_object('itens', v_estoque_insuf, 'autorizado_por', v_sup_estoque), null);
    end if;

    if v_total <= 0 then
      raise exception 'O total da venda deve ser maior que zero';
    end if;

    if jsonb_array_length(v_abaixo) > 0 then
      if p_autorizacao_desconto_id is null then
        raise exception 'Desconto abaixo do preco minimo exige autorizacao de supervisor';
      end if;
      v_sup := public.consumir_autorizacao(p_autorizacao_desconto_id, 'desconto_abaixo_piso', p_sessao_id);
      perform public.registrar_auditoria('vendas', v_id, 'desconto_abaixo_piso', null,
        jsonb_build_object('itens', v_abaixo, 'autorizado_por', v_sup, 'total', v_total), null);
    end if;

    for v_pag in select e from jsonb_array_elements(p_pagamentos) e loop
      v_forma := v_pag ->> 'forma';
      v_valor := public.arredondar_moeda((v_pag ->> 'valor')::numeric);
      v_parc := coalesce(nullif(v_pag ->> 'parcelas', '')::integer, 1);
      if v_forma is null or v_forma not in ('dinheiro', 'pix', 'debito', 'credito') then
        raise exception 'Forma de pagamento invalida';
      end if;
      if v_valor is null or v_valor <= 0 then
        raise exception 'Valor de pagamento invalido';
      end if;
      if v_forma <> 'credito' and v_parc <> 1 then
        raise exception 'Parcelamento so vale para credito';
      end if;
      insert into public.venda_pagamentos (venda_id, forma, valor, parcelas) values (v_id, v_forma, v_valor, v_parc);
      v_soma := v_soma + v_valor;
      if v_forma = 'dinheiro' then
        v_dinheiro := v_dinheiro + v_valor;
      end if;
    end loop;

    if abs(v_soma - v_total) > 0.01 then
      raise exception 'A soma dos pagamentos (%) nao bate com o total da venda (%)', v_soma, v_total;
    end if;
    if v_dinheiro > 0 then
      v_troco := v_dinheiro - (v_total - (v_soma - v_dinheiro));
      if v_troco > 0 then
        insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, criado_por)
        values (p_sessao_id, 'troco', -v_troco, 'Troco da venda #' || v_numero, auth.uid())
        returning id into v_mov;
      end if;
    end if;

    perform public.registrar_auditoria('vendas', v_id, 'venda_registrada', null,
      jsonb_build_object('numero', v_numero, 'total', v_total, 'forma_pagamento', p_pagamentos), null);

    return v_id;
  end
  $fn$;

  -- O Supabase da grant automatico (default privileges) pra anon/authenticated/service_role em toda
  -- function nova -- restaura exatamente o que a function antiga tinha (so authenticated, nada de
  -- anon/public), senao a troca de assinatura reabriria o acesso anonimo.
  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid) from public, anon, authenticated;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid) to authenticated;
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

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.autorizacoes_pontuais'::regclass and conname = 'autorizacoes_pontuais_acao_check';
  if v_def is null or v_def not like '%estoque_negativo%' then
    raise exception 'FALHA: constraint de acao nao inclui estoque_negativo';
  end if;

  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
     and pg_get_function_identity_arguments(p.oid) like '%p_autorizacao_estoque_id%';
  if v_n <> 1 then raise exception 'FALHA: registrar_venda sem o parametro p_autorizacao_estoque_id'; end if;

  -- So pode existir UMA versao de registrar_venda (senao o PostgREST fica ambiguo entre as duas
  -- assinaturas em toda chamada que nao manda p_autorizacao_estoque_id).
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda';
  if v_n <> 1 then raise exception 'FALHA: existe(m) % versao(oes) de registrar_venda, esperado exatamente 1', v_n; end if;

  if not has_function_privilege('authenticated', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda';
  end if;
  if has_function_privilege('anon', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em registrar_venda (deveria ter sido revogado)';
  end if;

  raise notice 'VERIFICACAO OK: constraint, functions e grants atualizados (so authenticated executa registrar_venda).';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_operador uuid;
  v_supervisor uuid;
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod uuid;
  v_var uuid;
  v_saldo bigint;
  v_autorizacao jsonb;
  v_venda uuid;
  v_ok boolean;
  v_n bigint;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id, deposito_id into v_caixa, v_dep from public.caixas where operacao_id = v_varejo and nome = 'CAIXA 1';
  -- Reaproveita uma sessao de caixa ja aberta de verdade (do uso real do sistema) em vez de tentar
  -- abrir outra -- abrir_sessao_caixa so permite uma aberta por caixa e por operador (mesmo padrao
  -- usado no teste do relatorio_varejo_dashboard).
  select cs.id, cs.operador_id into v_sessao, v_operador
    from public.caixa_sessoes cs where cs.operacao_id = v_varejo and cs.status = 'aberta' limit 1;
  v_operador := coalesce(v_operador, v_lucas);
  select profile_id into v_supervisor from public.usuario_operacoes
   where operacao_id = v_varejo and profile_id <> v_operador limit 1;
  if v_supervisor is null then
    raise exception 'ENSAIO INCONCLUSIVO: nenhum outro usuario com acesso ao varejo pra testar supervisor <> solicitante';
  end if;

  -- Preparo (Lucas, admin, contexto VAREJO): variacao sintetica com saldo pequeno conhecido, pra
  -- nao depender de dado real de producao, e PIN do supervisor escolhido (redefine pra um valor
  -- conhecido -- desfeito junto com o resto ao abortar a transacao, mesmo padrao ja usado nos
  -- testes de outras migrations deste projeto).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  insert into public.catalogo_produtos (nome, categoria) values ('ZZ ENSAIO ESTOQUE NEGATIVO', 'ANEL') returning id into v_prod;
  insert into public.catalogo_variacoes (produto_id, sku, preco_venda) values (v_prod, 'ZZ-ESTNEG-' || substr(gen_random_uuid()::text, 1, 8), 50) returning id into v_var;
  execute 'set constraints all immediate';
  perform public.registrar_entrada_estoque(v_dep, v_var, 2, 30.00, 'ensaio estoque negativo');
  perform public.definir_pin_supervisor(v_supervisor, '135790');
  execute 'reset role';

  select coalesce(sum(m.quantidade), 0) into v_saldo from public.estoque_movimentos m
   where m.variacao_id = v_var and m.deposito_id = v_dep and m.operacao_id = v_varejo;
  if v_saldo <> 2 then raise exception 'TESTE FALHOU [setup]: saldo inicial = %, esperado 2', v_saldo; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_operador, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  if v_sessao is null then
    v_sessao := public.abrir_sessao_caixa(v_caixa, 100);
  end if;

  -- T1. Vender mais que o saldo, sem autorizacao -> continua bloqueando (comportamento de hoje preservado)
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 5)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 250)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: vendeu acima do saldo sem nenhuma autorizacao'; end if;

  -- T2. O operador da sessao pede autorizacao ao supervisor com o PIN
  v_autorizacao := public.autorizar_acao(v_supervisor, '135790', 'estoque_negativo', v_sessao);
  if not (v_autorizacao ->> 'ok')::boolean then
    raise exception 'TESTE FALHOU [T2]: autorizacao de estoque_negativo nao foi concedida (%)', v_autorizacao;
  end if;

  -- T3. Com autorizacao valida, a venda acima do saldo completa e fica negativa, e fica auditada
  v_venda := public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 5)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 250)), null, null, null, null, (v_autorizacao ->> 'autorizacao_id')::uuid);
  select coalesce(sum(m.quantidade), 0) into v_saldo from public.estoque_movimentos m
   where m.variacao_id = v_var and m.deposito_id = v_dep and m.operacao_id = v_varejo;
  if v_saldo <> -3 then raise exception 'TESTE FALHOU [T3]: saldo final = %, esperado -3 (2 - 5)', v_saldo; end if;

  select count(*) into v_n from public.audit_log where acao = 'estoque_negativo' and registro_id = v_venda;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: venda com saldo negativo nao foi auditada'; end if;

  -- T4. A mesma autorizacao ja usada nao serve de novo (autorizacao pontual, uso unico)
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 50)), null, null, null, null, (v_autorizacao ->> 'autorizacao_id')::uuid);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: autorizacao de estoque reaproveitada'; end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T4 (bloqueia sem autorizacao, PIN concede, venda completa negativa e auditada, autorizacao de uso unico).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  alter table public.autorizacoes_pontuais drop constraint autorizacoes_pontuais_acao_check;
  alter table public.autorizacoes_pontuais add constraint autorizacoes_pontuais_acao_check
    check (acao in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento'));

  create or replace function public.autorizar_acao(p_supervisor_id uuid, p_pin text, p_acao text, p_alvo_id uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_sv public.supervisores%rowtype;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    if v_op is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    if p_acao not in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento') then
      raise exception 'Acao nao suportada';
    end if;
    if p_supervisor_id = auth.uid() then
      return jsonb_build_object('ok', false, 'motivo', 'auto_autorizacao');
    end if;
    select * into v_sv from public.supervisores
     where profile_id = p_supervisor_id and operacao_id = v_op and ativo for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'supervisor_invalido');
    end if;
    if v_sv.bloqueado_ate is not null and v_sv.bloqueado_ate > now() then
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
    end if;
    if p_pin is null or v_sv.pin_hash <> extensions.crypt(p_pin, v_sv.pin_hash) then
      update public.supervisores
         set tentativas_falhas = tentativas_falhas + 1,
             bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes' else bloqueado_ate end,
             atualizado_em = now()
       where profile_id = p_supervisor_id and operacao_id = v_op;
      perform public.registrar_auditoria('supervisores', p_supervisor_id, 'pin_supervisor_falhou', null,
        jsonb_build_object('acao', p_acao), null);
      return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
    end if;
    update public.supervisores set tentativas_falhas = 0, bloqueado_ate = null, atualizado_em = now()
     where profile_id = p_supervisor_id and operacao_id = v_op;
    insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
    values (p_acao, p_supervisor_id, auth.uid(), p_alvo_id, now() + interval '5 minutes')
    returning id into v_id;
    perform public.registrar_auditoria('autorizacoes_pontuais', v_id, 'autorizacao_concedida', null,
      jsonb_build_object('acao', p_acao, 'supervisor_id', p_supervisor_id, 'alvo_id', p_alvo_id), null);
    return jsonb_build_object('ok', true, 'autorizacao_id', v_id);
  end
  $fn$;

  -- Mesmo cuidado do $up$: precisa derrubar a assinatura de 8 parametros antes de recriar a de 7,
  -- senao ficam as duas overloaded (create or replace nao troca function com lista de tipos diferente).
  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid);

  create or replace function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null,
    p_cliente_nome text default null, p_cliente_documento text default null, p_autorizacao_desconto_id uuid default null
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_s public.caixa_sessoes%rowtype;
    v_dep uuid;
    v_id uuid;
    v_numero bigint;
    v_item jsonb;
    v_pag jsonb;
    v_var uuid;
    v_qtd integer;
    v_tab numeric;
    v_min numeric;
    v_piso numeric;
    v_prat numeric;
    v_custo numeric;
    v_saldo bigint;
    v_subtotal numeric := 0;
    v_total numeric := 0;
    v_abaixo jsonb := '[]'::jsonb;
    v_sup uuid;
    v_forma text;
    v_valor numeric;
    v_parc integer;
    v_soma numeric := 0;
    v_dinheiro numeric := 0;
    v_troco numeric;
    v_mov uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    if p_idempotency_key is not null then
      select v.id into v_id from public.vendas v where v.operacao_id = v_op and v.idempotency_key = p_idempotency_key;
      if found then
        return v_id;
      end if;
    end if;

    select * into v_s from public.caixa_sessoes where id = p_sessao_id and operacao_id = v_op for update;
    if not found or v_s.status <> 'aberta' then
      raise exception 'Sessao de caixa nao encontrada ou ja fechada';
    end if;
    if v_s.operador_id <> auth.uid() then
      raise exception 'A sessao de caixa pertence a outro operador';
    end if;
    select c.deposito_id into v_dep from public.caixas c where c.id = v_s.caixa_id and c.operacao_id = v_op;
    if v_dep is null then
      raise exception 'Caixa sem deposito de estoque configurado';
    end if;
    if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
      raise exception 'A venda precisa de ao menos um item';
    end if;
    if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array' or jsonb_array_length(p_pagamentos) = 0 then
      raise exception 'A venda precisa de ao menos um pagamento';
    end if;

    v_numero := public.proximo_numero_operacao('venda');
    insert into public.vendas (numero, sessao_id, deposito_id, operador_id, cliente_nome, cliente_documento, idempotency_key)
    values (v_numero, p_sessao_id, v_dep, auth.uid(), nullif(trim(p_cliente_nome), ''), nullif(trim(p_cliente_documento), ''), p_idempotency_key)
    returning id into v_id;

    for v_item in select e from jsonb_array_elements(p_itens) e loop
      v_var := (v_item ->> 'variacao_id')::uuid;
      v_qtd := (v_item ->> 'quantidade')::integer;
      if v_qtd is null or v_qtd <= 0 then
        raise exception 'Quantidade invalida';
      end if;
      select cv.preco_venda, cv.preco_minimo into v_tab, v_min
        from public.catalogo_variacoes cv
       where cv.id = v_var and cv.operacao_id = v_op and cv.ativo;
      if not found then
        raise exception 'Variacao nao encontrada ou inativa';
      end if;
      v_prat := coalesce(public.arredondar_moeda(nullif(v_item ->> 'preco_unitario', '')::numeric), v_tab);
      if v_prat < 0 or v_prat > v_tab then
        raise exception 'Preco praticado invalido (maximo: preco de tabela)';
      end if;
      v_piso := coalesce(v_min, v_tab);
      if v_prat < v_piso then
        v_abaixo := v_abaixo || jsonb_build_object('variacao_id', v_var, 'preco_tabela', v_tab, 'piso', v_piso, 'preco_praticado', v_prat);
      end if;

      select coalesce(sum(m.quantidade), 0) into v_saldo from public.estoque_movimentos m
       where m.variacao_id = v_var and m.deposito_id = v_dep and m.operacao_id = v_op;
      if v_saldo < v_qtd then
        raise exception 'Estoque insuficiente (saldo %, pedido %)', v_saldo, v_qtd;
      end if;
      v_custo := public.custo_medio_variacao(v_var);
      if v_custo is null then
        raise exception 'Variacao sem custo conhecido: registre uma entrada de estoque';
      end if;

      insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, documento_tipo, documento_id, criado_por)
      values (v_dep, v_var, 'venda', -v_qtd, v_custo, 'venda', v_id, auth.uid());
      insert into public.venda_itens (venda_id, variacao_id, quantidade, preco_tabela, preco_unitario, custo_unitario)
      values (v_id, v_var, v_qtd, v_tab, v_prat, v_custo);

      v_subtotal := v_subtotal + public.arredondar_moeda(v_tab * v_qtd);
      v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);
    end loop;

    if v_total <= 0 then
      raise exception 'O total da venda deve ser maior que zero';
    end if;

    if jsonb_array_length(v_abaixo) > 0 then
      if p_autorizacao_desconto_id is null then
        raise exception 'Desconto abaixo do preco minimo exige autorizacao de supervisor';
      end if;
      v_sup := public.consumir_autorizacao(p_autorizacao_desconto_id, 'desconto_abaixo_piso', p_sessao_id);
      perform public.registrar_auditoria('vendas', v_id, 'desconto_abaixo_piso', null,
        jsonb_build_object('itens', v_abaixo, 'autorizado_por', v_sup, 'total', v_total), null);
    end if;

    for v_pag in select e from jsonb_array_elements(p_pagamentos) e loop
      v_forma := v_pag ->> 'forma';
      v_valor := public.arredondar_moeda((v_pag ->> 'valor')::numeric);
      v_parc := coalesce(nullif(v_pag ->> 'parcelas', '')::integer, 1);
      if v_forma is null or v_forma not in ('dinheiro', 'pix', 'debito', 'credito') then
        raise exception 'Forma de pagamento invalida';
      end if;
      if v_valor is null or v_valor <= 0 then
        raise exception 'Valor de pagamento invalido';
      end if;
      if v_forma <> 'credito' and v_parc <> 1 then
        raise exception 'Parcelamento so vale para credito';
      end if;
      insert into public.venda_pagamentos (venda_id, forma, valor, parcelas) values (v_id, v_forma, v_valor, v_parc);
      v_soma := v_soma + v_valor;
      if v_forma = 'dinheiro' then
        v_dinheiro := v_dinheiro + v_valor;
      end if;
    end loop;

    if abs(v_soma - v_total) > 0.01 then
      raise exception 'A soma dos pagamentos (%) nao bate com o total da venda (%)', v_soma, v_total;
    end if;
    if v_dinheiro > 0 then
      v_troco := v_dinheiro - (v_total - (v_soma - v_dinheiro));
      if v_troco > 0 then
        insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, criado_por)
        values (p_sessao_id, 'troco', -v_troco, 'Troco da venda #' || v_numero, auth.uid())
        returning id into v_mov;
      end if;
    end if;

    perform public.registrar_auditoria('vendas', v_id, 'venda_registrada', null,
      jsonb_build_object('numero', v_numero, 'total', v_total, 'forma_pagamento', p_pagamentos), null);

    return v_id;
  end
  $fn$;

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid) from public, anon, authenticated;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid) to authenticated;
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
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as item
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('registrar_venda', 'autorizar_acao')
      union all
      select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as item
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
      union all
      select 'C ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
        from pg_constraint c where c.conrelid = 'public.autorizacoes_pontuais'::regclass and c.contype = 'c'
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

  raise exception 'ENSAIO OK: estoque_negativo liberado no Varejo com autorizacao de supervisor, testado (T1 a T4) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
