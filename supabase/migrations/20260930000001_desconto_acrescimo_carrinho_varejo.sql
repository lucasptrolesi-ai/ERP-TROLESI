-- Pedido do usuario (2026-09-30): um lugar no PDV Varejo pra aplicar desconto ou acrescimo no
-- carrinho inteiro (nao so por peca, que ja existe via editar o preco de cada item) -- em
-- percentual ou em valor, mesmo par de campos %/R$ ja usado no PDV Atacado (novo-pedido.tsx),
-- onde digitar o % calcula o R$ automaticamente e o R$ e o valor que realmente vale.
--
-- Decisao confirmada com o usuario: fica LIVRE, sem PIN de supervisor -- igual ja funciona no
-- Atacado hoje. A protecao de PIN que ja existe no Varejo (preco de uma PECA especifica abaixo do
-- minimo dela) continua exatamente como esta, e um mecanismo separado, sem relacao com isto.
--
-- Pre-requisito: etapa 20260925000001 (estoque negativo, ultima mudanca no registrar_venda).
--
-- O QUE FAZ (uma transacao so):
--   1. vendas ganha desconto_manual e acrescimo_manual (numeric, >= 0, default 0) -- gravados
--      separados de desconto_total (que continua sendo so o desconto por peca, subtotal-total dos
--      itens) pra nao violar o check desconto_total >= 0 quando o acrescimo for maior que o
--      desconto por peca.
--   2. registrar_venda() ganha p_valor_desconto e p_valor_acrescimo (numeric, default 0, ultimos
--      parametros -- chamada existente sem eles continua funcionando igual). Validado igual
--      criar_pedido (Atacado) ja faz: nenhum dos dois pode ser negativo (um acrescimo negativo
--      funcionaria como desconto nao auditado), e o total final nao pode ficar negativo. Aplicado
--      DEPOIS da checagem de preco abaixo do minimo por peca -- o desconto/acrescimo do carrinho
--      nao interfere nessa autorizacao, que continua olhando so o preco de cada item.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve tudo ao
-- -- estado anterior, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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

create temp table _fp_antes on commit drop as
  select item from (
    select 'COL desconto_manual' as item where exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'vendas' and column_name = 'desconto_manual'
    )
    union all
    select 'COL acrescimo_manual' where exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'vendas' and column_name = 'acrescimo_manual'
    )
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
    union all
    select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  alter table public.vendas add column if not exists desconto_manual numeric(12, 2) not null default 0 check (desconto_manual >= 0);
  alter table public.vendas add column if not exists acrescimo_manual numeric(12, 2) not null default 0 check (acrescimo_manual >= 0);

  -- CREATE OR REPLACE nao troca a function quando a lista de parametros muda -- precisa derrubar a
  -- assinatura antiga primeiro (mesmo cuidado das migrations anteriores que mexeram nesta function).
  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid);

  create or replace function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null,
    p_cliente_nome text default null, p_cliente_documento text default null, p_autorizacao_desconto_id uuid default null,
    p_autorizacao_estoque_id uuid default null, p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0
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
    v_total_final numeric;
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

    -- Desconto/acrescimo do carrinho inteiro (pedido do usuario, 2026-09-30) -- livre, sem PIN de
    -- supervisor (decisao do usuario): mecanismo separado da autorizacao de preco abaixo do minimo
    -- por peca acima, que continua olhando so o preco de cada item, sem relacao com isto.
    if coalesce(p_valor_desconto, 0) < 0 then
      raise exception 'Desconto nao pode ser negativo';
    end if;
    if coalesce(p_valor_acrescimo, 0) < 0 then
      raise exception 'Acrescimo nao pode ser negativo -- um acrescimo negativo funcionaria como desconto nao auditado';
    end if;
    v_total_final := v_total - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0);
    if v_total_final < 0 then
      raise exception 'Valor a pagar nao pode ficar negativo';
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
    if v_soma < v_total_final then
      raise exception 'Pagamento insuficiente';
    end if;
    v_troco := v_soma - v_total_final;
    if v_troco > v_dinheiro then
      raise exception 'Troco maior que o dinheiro recebido';
    end if;

    update public.vendas
       set subtotal = v_subtotal, desconto_total = v_subtotal - v_total, total = v_total_final, troco = v_troco,
           desconto_autorizado_por = v_sup, desconto_manual = coalesce(p_valor_desconto, 0), acrescimo_manual = coalesce(p_valor_acrescimo, 0)
     where id = v_id;

    if v_dinheiro - v_troco > 0 then
      insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, documento_id, criado_por)
      values (p_sessao_id, 'venda_dinheiro', v_dinheiro - v_troco, 'Venda ' || v_numero, v_id, auth.uid())
      returning id into v_mov;
      perform public.registrar_auditoria('caixa_movimentos', v_mov, 'venda_dinheiro_caixa', null,
        jsonb_build_object('sessao_id', p_sessao_id, 'venda_id', v_id, 'valor', v_dinheiro - v_troco), null);
    end if;

    return v_id;
  end
  $fn$;
  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric) from anon, authenticated, public;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric) to authenticated;
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

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vendas' and column_name = 'desconto_manual') then
    raise exception 'FALHA: vendas.desconto_manual nao existe';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vendas' and column_name = 'acrescimo_manual') then
    raise exception 'FALHA: vendas.acrescimo_manual nao existe';
  end if;

  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda';
  if v_n <> 1 then raise exception 'FALHA: existe(m) % versao(oes) de registrar_venda, esperado exatamente 1', v_n; end if;

  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric)') is null then
    raise exception 'FALHA: registrar_venda com os 2 parametros novos nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda';
  end if;
  if has_function_privilege('anon', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric)', 'execute') then
    raise exception 'FALHA: anon com execute em registrar_venda';
  end if;

  raise notice 'VERIFICACAO OK: colunas novas e registrar_venda com desconto/acrescimo, tudo no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_operador uuid;
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod uuid;
  v_var uuid;
  v_venda uuid;
  v_ok boolean;
  v_n bigint;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id, deposito_id into v_caixa, v_dep from public.caixas where operacao_id = v_varejo and nome = 'CAIXA 1';
  select cs.id, cs.operador_id into v_sessao, v_operador
    from public.caixa_sessoes cs where cs.operacao_id = v_varejo and cs.status = 'aberta' limit 1;
  v_operador := coalesce(v_operador, v_lucas);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  insert into public.catalogo_produtos (nome, categoria) values ('ZZ ENSAIO DESCONTO CARRINHO', 'ANEL') returning id into v_prod;
  insert into public.catalogo_variacoes (produto_id, sku, preco_venda) values (v_prod, 'ZZ-DESCCARR-' || substr(gen_random_uuid()::text, 1, 8), 100) returning id into v_var;
  execute 'set constraints all immediate';
  perform public.registrar_entrada_estoque(v_dep, v_var, 10, 40.00, 'ensaio desconto carrinho');
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_operador, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  if v_sessao is null then
    v_sessao := public.abrir_sessao_caixa(v_caixa, 100);
  end if;

  -- T1. Desconto do carrinho: 2x100 = 200, desconto 20 -> paga 180, sem PIN nenhum
  v_venda := public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 180)), null, null, null, null, null, 20, 0);
  select count(*) into v_n from public.vendas where id = v_venda and total = 180 and desconto_manual = 20 and acrescimo_manual = 0;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: desconto do carrinho nao aplicou o total certo'; end if;

  -- T2. Acrescimo do carrinho: 1x100 = 100, acrescimo 15 -> paga 115
  v_venda := public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 115)), null, null, null, null, null, 0, 15);
  select count(*) into v_n from public.vendas where id = v_venda and total = 115 and desconto_manual = 0 and acrescimo_manual = 15;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: acrescimo do carrinho nao aplicou o total certo'; end if;

  -- T3. Chamada antiga (sem os 2 parametros novos) continua funcionando, total sem nenhum ajuste
  v_venda := public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 100)));
  select count(*) into v_n from public.vendas where id = v_venda and total = 100 and desconto_manual = 0 and acrescimo_manual = 0;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: chamada sem os parametros novos quebrou'; end if;

  -- T4. Desconto negativo -> recusado
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 100)), null, null, null, null, null, -5, 0);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: desconto negativo foi aceito'; end if;

  -- T5. Acrescimo negativo -> recusado (funcionaria como desconto nao auditado)
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 100)), null, null, null, null, null, 0, -5);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: acrescimo negativo foi aceito'; end if;

  -- T6. Desconto maior que o total -> total final ficaria negativo, recusado
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 1)), null, null, null, null, null, 500, 0);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T6]: desconto maior que o total nao foi recusado'; end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T6 (desconto aplica, acrescimo aplica, chamada antiga sem quebrar, desconto/acrescimo negativos recusados, desconto maior que o total recusado).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric);

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
    if v_soma < v_total then
      raise exception 'Pagamento insuficiente';
    end if;
    v_troco := v_soma - v_total;
    if v_troco > v_dinheiro then
      raise exception 'Troco maior que o dinheiro recebido';
    end if;

    update public.vendas
       set subtotal = v_subtotal, desconto_total = v_subtotal - v_total, total = v_total, troco = v_troco,
           desconto_autorizado_por = v_sup
     where id = v_id;

    if v_dinheiro - v_troco > 0 then
      insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, documento_id, criado_por)
      values (p_sessao_id, 'venda_dinheiro', v_dinheiro - v_troco, 'Venda ' || v_numero, v_id, auth.uid())
      returning id into v_mov;
      perform public.registrar_auditoria('caixa_movimentos', v_mov, 'venda_dinheiro_caixa', null,
        jsonb_build_object('sessao_id', p_sessao_id, 'venda_id', v_id, 'valor', v_dinheiro - v_troco), null);
    end if;

    return v_id;
  end
  $fn$;
  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid) from anon, authenticated, public;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid) to authenticated;

  alter table public.vendas drop column if exists desconto_manual;
  alter table public.vendas drop column if exists acrescimo_manual;
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
      select 'COL desconto_manual' as item where exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'vendas' and column_name = 'desconto_manual'
      )
      union all
      select 'COL acrescimo_manual' where exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'vendas' and column_name = 'acrescimo_manual'
      )
      union all
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
      union all
      select 'A ' || p.oid::regprocedure::text || ' ' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
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

  raise exception 'ENSAIO OK: desconto/acrescimo do carrinho no Varejo (livre, sem PIN) testado (T1 a T6) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
