-- Cliente de verdade no PDV Varejo (pedido do usuario, 2026-10-19, Fase 1 de 3 -- cliente, cupom,
-- cashback): ate aqui o PDV Varejo so tinha um campo de texto livre opcional pro nome -- nenhum
-- vinculo real com a tabela `clientes` (ja existente, usada pelo Atacado desde 20260713000002).
-- Reaproveita essa MESMA tabela (global, sem operacao_id) em vez de criar uma tabela paralela pro
-- Varejo -- um cliente pode comprar nas duas operacoes, nao faz sentido duas identidades separadas.
-- A tela do Varejo (src/lib/actions/clientes-varejo.ts) so vai expor/gravar os poucos campos que
-- importam pra loja (nome, telefone, cpf_cnpj) -- os campos de crediario legado/Receita Federal que
-- a tabela carrega do Atacado ficam de fora, inalterados.
--
-- `vendas.cliente_id` e a base necessaria pra Fase 3 (cashback): precisa conseguir perguntar "esse
-- cliente tem cashback disponivel?" e, pra isso, precisa de um vinculo real com o cliente, nao so um
-- nome solto em texto (que pode vir digitado diferente a cada venda).
--
-- registrar_venda ganha o parametro p_cliente_id (opcional, default null -- venda sem cliente
-- continua funcionando exatamente como antes). Assinatura muda (10 -> 11 parametros), entao precisa
-- de DROP explicito antes do CREATE OR REPLACE (regra do projeto: CREATE OR REPLACE so preserva
-- grants quando a lista de tipos de parametro e IDENTICA).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo (o bloco DO $down$ mais abaixo devolve tudo ao estado anterior, testado pelo proprio modo
-- -- 'ensaio' antes de chegar aqui). ATENCAO: linhas de venda real com cliente_id preenchido perdem
-- -- esse vinculo no rollback (coluna e apagada) -- cliente_nome/cliente_documento (snapshot em
-- -- texto) continuam intactos, so o link pro cadastro some.
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
    select 'COL vendas.' || c.column_name as item from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'vendas'
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_venda'
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  alter table public.vendas add column cliente_id uuid references public.clientes (id);
  create index vendas_cliente_id_idx on public.vendas (cliente_id) where cliente_id is not null;

  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric);

  create or replace function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid
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
    v_desp_var numeric;
    v_piso_prejuizo numeric;
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
    insert into public.vendas (numero, sessao_id, deposito_id, operador_id, cliente_id, cliente_nome, cliente_documento, idempotency_key)
    values (v_numero, p_sessao_id, v_dep, auth.uid(), p_cliente_id, nullif(trim(p_cliente_nome), ''), nullif(trim(p_cliente_documento), ''), p_idempotency_key)
    returning id into v_id;

    -- Piso de prejuizo (Controle Financeiro do Varejo, Fase 5, 2026-10-08): busca a configuracao
    -- financeira vigente UMA SO VEZ (nao muda no meio da transacao -- nao precisa repetir por item,
    -- diferente de custo_medio_variacao, que esse sim e por peca). Despesas variaveis em 100% ou
    -- mais e erro de configuracao (nenhum preco cobriria o custo por formula nenhuma) -- avisa
    -- explicito em vez de silenciosamente deixar de aplicar a trava.
    select vc.despesas_variaveis_pct into v_desp_var from public.varejo_config vc
     where vc.operacao_id = v_op and vc.vigente_desde <= current_date
     order by vc.vigente_desde desc limit 1;
    if v_desp_var is not null and v_desp_var >= 1 then
      raise exception 'Configuracao financeira com despesas variaveis em 100%% ou mais -- nenhum preco cobre o custo, corrija a configuracao antes de vender';
    end if;

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

      -- Piso de prejuizo (Controle Financeiro do Varejo, Fase 5, 2026-10-08): vender abaixo do que a
      -- despesa variavel cobre e prejuizo na certa, nao desconto -- bloqueia sempre, sem autorizacao
      -- possivel (diferente do preco abaixo do preco_minimo acima, que pode ser decisao comercial
      -- valida e por isso aceita PIN). v_desp_var ja veio lido (e validado < 1) antes do loop; sem
      -- config cadastrada ainda (v_desp_var null), mantem o comportamento de sempre.
      if v_desp_var is not null then
        v_piso_prejuizo := public.arredondar_moeda(v_custo / (1 - v_desp_var));
        if v_prat < v_piso_prejuizo then
          raise exception 'Preco abaixo do piso de prejuizo (minimo: %) -- venda bloqueada', v_piso_prejuizo;
        end if;
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

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid) from public, anon;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid) to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vendas' and column_name = 'cliente_id') then
    raise exception 'FALHA: vendas.cliente_id nao existe';
  end if;
  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid)') is null then
    raise exception 'FALHA: registrar_venda com 11 parametros nao existe';
  end if;
  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric)') is not null then
    raise exception 'FALHA: assinatura antiga (10 parametros) de registrar_venda ainda existe';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda';
  end if;
  if has_function_privilege('anon', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em registrar_venda';
  end if;

  raise notice 'VERIFICACAO OK: vendas.cliente_id, nova assinatura de registrar_venda e grants no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod uuid;
  v_var uuid;
  v_cliente uuid;
  v_venda1 uuid;
  v_venda2 uuid;
  v_n bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- Cliente de teste
  insert into public.clientes (nome, telefone) values ('ZZ ENSAIO CLIENTE VAREJO', '35999999999') returning id into v_cliente;

  -- Peca + estoque de apoio
  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO VENDA CLIENTE', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ010', 'atributos', '{}'::jsonb, 'preco_venda', 50.00)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var, 5, 10.00, 'ensaio cliente varejo');

  select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
  v_sessao := public.abrir_sessao_caixa(v_caixa, 0);

  -- T1. Venda COM cliente_id -> grava o vinculo
  v_venda1 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 50.00)),
    gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
  );
  select count(*) into v_n from public.vendas where id = v_venda1 and cliente_id = v_cliente;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: venda nao gravou o cliente_id'; end if;

  -- T2. Venda SEM cliente_id (chamada antiga, so com nome texto) -- continua funcionando igual antes
  v_venda2 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 50.00)),
    gen_random_uuid(), 'Cliente so em texto', null, null, null, 0, 0
  );
  select count(*) into v_n from public.vendas where id = v_venda2 and cliente_id is null and cliente_nome = 'Cliente so em texto';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: venda sem cliente_id (chamada no formato antigo) nao gravou como antes'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T2 (venda com cliente vinculado, venda no formato antigo continua igual).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid);

  create or replace function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0
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
    v_desp_var numeric;
    v_piso_prejuizo numeric;
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

    select vc.despesas_variaveis_pct into v_desp_var from public.varejo_config vc
     where vc.operacao_id = v_op and vc.vigente_desde <= current_date
     order by vc.vigente_desde desc limit 1;
    if v_desp_var is not null and v_desp_var >= 1 then
      raise exception 'Configuracao financeira com despesas variaveis em 100%% ou mais -- nenhum preco cobre o custo, corrija a configuracao antes de vender';
    end if;

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
        v_estoque_insuf := v_estoque_insuf || jsonb_build_object('variacao_id', v_var, 'saldo', v_saldo, 'quantidade_pedida', v_qtd);
      end if;
      v_custo := public.custo_medio_variacao(v_var);
      if v_custo is null then
        raise exception 'Variacao sem custo conhecido: registre uma entrada de estoque';
      end if;

      if v_desp_var is not null then
        v_piso_prejuizo := public.arredondar_moeda(v_custo / (1 - v_desp_var));
        if v_prat < v_piso_prejuizo then
          raise exception 'Preco abaixo do piso de prejuizo (minimo: %) -- venda bloqueada', v_piso_prejuizo;
        end if;
      end if;

      insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, documento_tipo, documento_id, criado_por)
      values (v_dep, v_var, 'venda', -v_qtd, v_custo, 'venda', v_id, auth.uid());
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

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric) from public, anon;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric) to authenticated;

  drop index if exists public.vendas_cliente_id_idx;
  alter table public.vendas drop column if exists cliente_id;
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
      select 'COL vendas.' || c.column_name as item from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'vendas'
      union all
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
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

  raise exception 'ENSAIO OK: cliente de verdade no PDV Varejo (vendas.cliente_id, registrar_venda com p_cliente_id), testado (T1 a T2) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
