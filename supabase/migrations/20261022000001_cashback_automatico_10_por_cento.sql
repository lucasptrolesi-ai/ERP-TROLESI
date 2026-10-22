-- Cashback deixa de ser livre -- agora e sempre 10% do total pago, vencimento sempre em 30 dias
-- (pedido do usuario, 2026-10-22: "compro 100, tenho 10 de cashback na proxima compra, com validade
-- de 30 dias"). O vendedor continua decidindo SE concede (checkbox no PDV), mas nao quanto nem até
-- quando -- isso sai do controle dele e vira uma regra fixa calculada pelo banco a partir de
-- vendas.total ja persistido (nunca confia em valor/data vindos do cliente).
--
-- Muda a assinatura de duas functions (perde parametro -- precisa de DROP explicito antes do CREATE,
-- GRANTs nao sao preservados entre assinaturas diferentes):
-- - conceder_cashback(uuid, numeric, date) -> conceder_cashback(uuid) -- calcula o valor (10% de
--   vendas.total) e o vencimento (+30 dias) por dentro, em vez de receber de fora.
-- - registrar_venda_varejo_com_cashback(..., numeric, date) -> (..., boolean) -- os dois ultimos
--   parametros (valor/vencimento a conceder) viram um so (conceder ou nao).
--
-- validar_cashback_lancamento() (trigger BEFORE INSERT) ganha uma checagem nova: nenhum insert pode
-- gravar valor maior que 10% do total da venda de origem -- sem isso, um insert DIRETO (RLS FOR ALL
-- libera admin/vendedor) ainda podia conceder qualquer valor, contornando a regra que
-- conceder_cashback agora aplica -- mesma classe de bypass que esta trigger ja fecha pros outros
-- campos desde a migration original (20261021000001).
--
-- Zero linhas reais em cashback_lancamentos ate agora (confirmado antes de escrever esta migration --
-- a feature acabou de ir pro ar ontem e ainda nao foi usada numa venda real) -- nao precisa de
-- backfill nem de decidir o que fazer com cashback concedido sob a regra antiga.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo. Devolve as duas functions pra assinatura livre (valor/vencimento escolhidos por fora) e
-- -- remove a checagem de 10% da trigger -- nenhum cashback concedido sob a regra nova precisa ser
-- -- desfeito, os valores ja gravados continuam os mesmos, so a regra de novos lancamentos muda.
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque so esta linha): 'ensaio' | 'aplicar' | 'desfazer'
select set_config('app.modo_migration', 'aplicar', true);
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

  drop function if exists public.conceder_cashback(uuid, numeric, date);

  create function public.conceder_cashback(p_venda_id uuid)
  returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_venda public.vendas%rowtype;
    v_valor numeric;
    v_vencimento date;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    select * into v_venda from public.vendas where id = p_venda_id and operacao_id = v_op;
    if not found then
      raise exception 'Venda nao encontrada';
    end if;
    if v_venda.cliente_id is null then
      raise exception 'Essa venda nao tem cliente vinculado -- nao e possivel conceder cashback';
    end if;

    -- 10% do total REALMENTE pago (vendas.total ja reflete desconto/acrescimo do carrinho) --
    -- vencimento sempre 30 dias corridos a partir de hoje, no fuso de Brasilia (nao current_date
    -- puro, que e UTC nesta sessao -- mesma razao do resto desta migration/da original).
    v_valor := public.arredondar_moeda(v_venda.total * 0.10);
    if v_valor <= 0 then
      return null;
    end if;
    v_vencimento := (now() at time zone 'America/Sao_Paulo')::date + 30;

    -- Retry idempotente (mesma logica da versao anterior): o indice unico em venda_origem_id garante
    -- que so existe UM cashback concedido por venda -- aqui so trata a violacao devolvendo o
    -- lancamento ja existente em vez de propagar o erro.
    begin
      insert into public.cashback_lancamentos (cliente_id, venda_origem_id, operacao_id, valor, vencimento, criado_por)
      values (v_venda.cliente_id, p_venda_id, v_op, v_valor, v_vencimento, auth.uid())
      returning id into v_id;
    exception
      when unique_violation then
        select id into v_id from public.cashback_lancamentos where venda_origem_id = p_venda_id;
    end;

    return v_id;
  end
  $fn$;

  revoke execute on function public.conceder_cashback(uuid) from public, anon;
  grant execute on function public.conceder_cashback(uuid) to authenticated;

  drop function if exists public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date
  );

  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid,
    p_cashback_resgatar_id uuid default null::uuid,
    p_conceder_cashback boolean default false
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_venda_id uuid;
    v_valor_resgatado numeric;
  begin
    v_venda_id := public.registrar_venda(
      p_sessao_id, p_itens, p_pagamentos, p_idempotency_key,
      p_cliente_nome, p_cliente_documento, p_autorizacao_desconto_id, p_autorizacao_estoque_id,
      p_valor_desconto, p_valor_acrescimo, p_cliente_id
    );

    if p_cashback_resgatar_id is not null then
      v_valor_resgatado := public.resgatar_cashback(p_cashback_resgatar_id, v_venda_id);
      if p_valor_desconto < v_valor_resgatado then
        raise exception 'O desconto da venda (%) e menor que o cashback resgatado (%) -- o cliente precisa receber o valor do cashback como desconto', p_valor_desconto, v_valor_resgatado;
      end if;
    end if;

    if p_conceder_cashback then
      perform public.conceder_cashback(v_venda_id);
    end if;

    return v_venda_id;
  end
  $fn$;

  revoke execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean
  ) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean
  ) to authenticated;

  -- Mesma assinatura de antes (returns trigger, sem parametros explicitos) -- create or replace
  -- basta, sem precisar de DROP.
  create or replace function public.validar_cashback_lancamento()
  returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_venda public.vendas%rowtype;
  begin
    if new.vencimento <= (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Data de vencimento do cashback deve ser no futuro';
    end if;
    select * into v_venda from public.vendas where id = new.venda_origem_id;
    if v_venda.cliente_id is null or v_venda.cliente_id is distinct from new.cliente_id then
      raise exception 'cliente_id do cashback precisa ser o mesmo da venda de origem';
    end if;
    if v_venda.operacao_id is distinct from new.operacao_id then
      raise exception 'operacao_id do cashback precisa ser o mesmo da venda de origem';
    end if;
    -- Achado ao travar o valor em 10% fixo (2026-10-22): sem este check, um insert DIRETO (RLS FOR
    -- ALL libera admin/vendedor) ainda podia conceder qualquer valor, contornando a regra que
    -- conceder_cashback agora aplica -- mesma classe de bypass que esta trigger ja fecha pros outros
    -- campos.
    if new.valor > public.arredondar_moeda(v_venda.total * 0.10) then
      raise exception 'Cashback nao pode passar de 10%% do valor da venda de origem';
    end if;
    return new;
  end
  $fn$;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.conceder_cashback(uuid, numeric, date)') is not null then
    raise exception 'FALHA: assinatura antiga de conceder_cashback ainda existe';
  end if;
  if to_regprocedure('public.conceder_cashback(uuid)') is null then
    raise exception 'FALHA: conceder_cashback(uuid) nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.conceder_cashback(uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em conceder_cashback(uuid)';
  end if;
  if has_function_privilege('anon', 'public.conceder_cashback(uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em conceder_cashback(uuid)';
  end if;

  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date)') is not null then
    raise exception 'FALHA: assinatura antiga de registrar_venda_varejo_com_cashback ainda existe';
  end if;
  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean)') is null then
    raise exception 'FALHA: registrar_venda_varejo_com_cashback (assinatura nova) nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda_varejo_com_cashback (nova)';
  end if;
  if has_function_privilege('anon', 'public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean)', 'execute') then
    raise exception 'FALHA: anon com execute em registrar_venda_varejo_com_cashback (nova)';
  end if;

  raise notice 'VERIFICACAO OK: conceder_cashback(uuid) e registrar_venda_varejo_com_cashback (assinatura nova, com p_conceder_cashback boolean) no lugar, assinaturas antigas removidas, grants corretos.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_cliente uuid;
  v_prod uuid;
  v_var uuid;
  v_venda100 uuid;
  v_lanc uuid;
  v_valor numeric;
  v_vencimento date;
  v_n int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  insert into public.clientes (nome, telefone) values ('ZZ ENSAIO CASHBACK 10PCT', '35966665555') returning id into v_cliente;

  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO CASHBACK 10PCT', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ10PCT', 'atributos', '{}'::jsonb, 'preco_venda', 100.00)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var, 10, 20.00, 'ensaio cashback 10pct');

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- T1. Venda de R$100 -> conceder_cashback(venda), sem passar valor nem data, concede exatamente
  -- R$10 (10% de 100), vencendo em +30 dias a partir de hoje (fuso de Brasilia).
  v_venda100 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
    gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
  );
  v_lanc := public.conceder_cashback(v_venda100);
  select valor, vencimento into v_valor, v_vencimento from public.cashback_lancamentos where id = v_lanc;
  if v_valor <> 10.00 then raise exception 'TESTE FALHOU [T1]: cashback deveria ser 10.00 (10%% de 100), veio %', v_valor; end if;
  if v_vencimento <> (now() at time zone 'America/Sao_Paulo')::date + 30 then
    raise exception 'TESTE FALHOU [T1]: vencimento deveria ser hoje + 30 dias, veio %', v_vencimento;
  end if;

  -- T2. Insert DIRETO com valor acima de 10% do total da venda de origem e bloqueado pela trigger
  -- (defesa em profundidade -- RLS FOR ALL libera admin/vendedor inserir direto, contornando
  -- conceder_cashback).
  declare
    v_venda_t2 uuid;
  begin
    v_venda_t2 := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
    );
    begin
      insert into public.cashback_lancamentos (cliente_id, venda_origem_id, operacao_id, valor, vencimento)
      values (v_cliente, v_venda_t2, v_varejo, 10.01, (now() at time zone 'America/Sao_Paulo')::date + 30);
      raise exception 'TESTE FALHOU [T2]: insert direto acima de 10%% deveria ter sido bloqueado';
    exception
      when others then
        if sqlerrm <> 'Cashback nao pode passar de 10% do valor da venda de origem' then raise; end if;
    end;
  end;

  -- T3. Wrapper (registrar_venda_varejo_com_cashback) com p_conceder_cashback := true concede 10%
  -- automaticamente numa venda de R$50, sem passar valor nenhum -- so o sim/nao.
  declare
    v_prod50 uuid;
    v_var50 uuid;
    v_venda_t3 uuid;
    v_valor_t3 numeric;
  begin
    -- Produto PROPRIO com preco de tabela 50.00, vendido sem desconto nenhum no item -- usar
    -- 'preco_unitario' pra vender o produto de 100.00 por 50.00 (metade da tabela) cai no piso de
    -- preco minimo: sem preco_minimo configurado, o piso vira a propria tabela (100.00), e qualquer
    -- preco praticado abaixo dela exige autorizacao de supervisor (achado ao Lucas rodar o ensaio de
    -- verdade -- "Desconto abaixo do preco minimo exige autorizacao de supervisor").
    v_prod50 := public.cadastrar_produto_catalogo('ZZ ENSAIO CASHBACK 10PCT 50', 'ANEL',
      jsonb_build_array(jsonb_build_object('sku', 'ZZ10PCT50', 'atributos', '{}'::jsonb, 'preco_venda', 50.00)));
    select id into v_var50 from public.catalogo_variacoes where produto_id = v_prod50;
    perform public.registrar_entrada_estoque(v_dep, v_var50, 5, 10.00, 'ensaio cashback 10pct 50');

    v_venda_t3 := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var50, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 50.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
      null, true
    );
    select valor into v_valor_t3 from public.cashback_lancamentos where venda_origem_id = v_venda_t3;
    if v_valor_t3 <> 5.00 then raise exception 'TESTE FALHOU [T3]: wrapper deveria ter concedido 5.00 (10%% de 50), concedeu %', v_valor_t3; end if;
  end;

  -- T4. Round-trip completo ainda funciona: o cashback concedido no T1 (R$10) e resgatavel numa
  -- venda seguinte do mesmo cliente, exatamente como antes desta migration.
  declare
    v_venda_resgate uuid;
  begin
    v_venda_resgate := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
      gen_random_uuid(), null, null, null, null, 10.00, 0, v_cliente,
      v_lanc, false
    );
    select count(*) into v_n from public.cashback_lancamentos where id = v_lanc and situacao = 'usado' and usado_na_venda_id = v_venda_resgate;
    if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: resgate do cashback concedido no T1 deveria ter funcionado'; end if;
  end;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T4 (conceder_cashback calcula 10%% do total e vencimento +30 dias sozinho sem receber nada de fora, trigger bloqueia insert direto acima de 10%%, wrapper concede automaticamente so com um boolean, round-trip concede->resgata continua funcionando).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean
  );
  drop function if exists public.conceder_cashback(uuid);

  create function public.conceder_cashback(p_venda_id uuid, p_valor numeric, p_vencimento date)
  returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_venda public.vendas%rowtype;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    select * into v_venda from public.vendas where id = p_venda_id and operacao_id = v_op;
    if not found then
      raise exception 'Venda nao encontrada';
    end if;
    if v_venda.cliente_id is null then
      raise exception 'Essa venda nao tem cliente vinculado -- nao e possivel conceder cashback';
    end if;

    if p_valor is null or p_valor <= 0 then
      raise exception 'Valor do cashback deve ser maior que zero';
    end if;
    if p_vencimento is null or p_vencimento <= (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Data de vencimento do cashback deve ser no futuro';
    end if;

    begin
      insert into public.cashback_lancamentos (cliente_id, venda_origem_id, operacao_id, valor, vencimento, criado_por)
      values (v_venda.cliente_id, p_venda_id, v_op, public.arredondar_moeda(p_valor), p_vencimento, auth.uid())
      returning id into v_id;
    exception
      when unique_violation then
        select id into v_id from public.cashback_lancamentos where venda_origem_id = p_venda_id;
    end;

    return v_id;
  end
  $fn$;

  revoke execute on function public.conceder_cashback(uuid, numeric, date) from public, anon;
  grant execute on function public.conceder_cashback(uuid, numeric, date) to authenticated;

  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid,
    p_cashback_resgatar_id uuid default null::uuid,
    p_cashback_conceder_valor numeric default null::numeric,
    p_cashback_conceder_vencimento date default null::date
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_venda_id uuid;
    v_valor_resgatado numeric;
  begin
    v_venda_id := public.registrar_venda(
      p_sessao_id, p_itens, p_pagamentos, p_idempotency_key,
      p_cliente_nome, p_cliente_documento, p_autorizacao_desconto_id, p_autorizacao_estoque_id,
      p_valor_desconto, p_valor_acrescimo, p_cliente_id
    );

    if p_cashback_resgatar_id is not null then
      v_valor_resgatado := public.resgatar_cashback(p_cashback_resgatar_id, v_venda_id);
      if p_valor_desconto < v_valor_resgatado then
        raise exception 'O desconto da venda (%) e menor que o cashback resgatado (%) -- o cliente precisa receber o valor do cashback como desconto', p_valor_desconto, v_valor_resgatado;
      end if;
    end if;

    if p_cashback_conceder_valor is not null and p_cashback_conceder_valor > 0 then
      perform public.conceder_cashback(v_venda_id, p_cashback_conceder_valor, p_cashback_conceder_vencimento);
    end if;

    return v_venda_id;
  end
  $fn$;

  revoke execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date
  ) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date
  ) to authenticated;

  create or replace function public.validar_cashback_lancamento()
  returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_venda public.vendas%rowtype;
  begin
    if new.vencimento <= (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Data de vencimento do cashback deve ser no futuro';
    end if;
    select * into v_venda from public.vendas where id = new.venda_origem_id;
    if v_venda.cliente_id is null or v_venda.cliente_id is distinct from new.cliente_id then
      raise exception 'cliente_id do cashback precisa ser o mesmo da venda de origem';
    end if;
    if v_venda.operacao_id is distinct from new.operacao_id then
      raise exception 'operacao_id do cashback precisa ser o mesmo da venda de origem';
    end if;
    return new;
  end
  $fn$;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if to_regprocedure('public.conceder_cashback(uuid)') is not null
     or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean)') is not null
     or to_regprocedure('public.conceder_cashback(uuid, numeric, date)') is null
     or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date)') is null then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu conceder_cashback/registrar_venda_varejo_com_cashback as assinaturas originais.';
  end if;

  raise exception 'ENSAIO OK: cashback travado em 10%% do total da venda com vencimento fixo de 30 dias (conceder_cashback(uuid) e registrar_venda_varejo_com_cashback com p_conceder_cashback boolean), trigger com checagem de 10%% pra bloquear insert direto acima do limite, testado (T1 a T4) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
