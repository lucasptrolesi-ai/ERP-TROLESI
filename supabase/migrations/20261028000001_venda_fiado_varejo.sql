-- Venda fiado/a prazo no PDV Varejo, "como se fosse um crediário" -- pedido do usuário,
-- 2026-10-28. Decisões confirmadas com o usuário antes de codar:
--   1. Exige PIN de supervisor (mesmo padrão de desconto_abaixo_piso/estoque_negativo).
--   2. Cliente com parcela em atraso NÃO é bloqueado -- só mostra aviso (não é pedido do usuário
--      impedir a venda, só alertar o vendedor).
--   3. Tela de recebimento fica em /varejo/crediario, separada do Controle Financeiro.
--   4. Formato: uma data única OU várias parcelas, ajustável -- igual ao "misto" do Atacado
--      (entrada em dinheiro/pix/débito/crédito opcional + o resto parcelado).
--
-- Reaproveita a infra do Atacado em vez de duplicar, porque já é genérica (não presa a ATACADO):
--   - `contas_receber`: já tem `operacao_id` (carimbado sozinho por trigger), `numero_parcela`/
--     `total_parcelas`, enum `forma_pagamento` já tem 'promissoria' -- só falta uma referência pra
--     ORIGEM venda (hoje só tem `pedido_id`). Ganha `venda_id` nullable, com
--     `num_nonnulls(pedido_id, venda_id) = 1` (mesmo padrão de origem mutuamente exclusiva já usado
--     em `varejo_dividas_atacado`/`venda_itens`).
--   - `dar_baixa_em_lote_contas_receber` (RPC que já existe, genérica, sem referência a ATACADO) --
--     reaproveitada tal e qual pela tela nova /varejo/crediario, nenhuma mudança nela.
--   - `autorizar_acao`/`consumir_autorizacao` (RPCs já existentes) -- só adiciona 'venda_fiado' na
--     whitelist de ações suportadas.
--
-- `registrar_venda` ganha dois parâmetros NOVOS no final (compatível com CREATE OR REPLACE,
-- assinatura antiga continua funcionando pra quem não manda eles): `p_parcelas_fiado jsonb` (array
-- de {valor, vencimento}) e `p_autorizacao_fiado_id uuid`. Quando vem parcelas fiado: exige
-- `p_cliente_id` (precisa saber de quem cobrar depois) e a autorização de supervisor; a soma das
-- parcelas + o que foi pago em `p_pagamentos` (entrada opcional) tem que bater com o total --
-- `p_pagamentos` pode vir vazio agora quando o fiado cobre a venda inteira (antes era sempre
-- obrigatório pelo menos um pagamento). Cada parcela vira uma linha em `contas_receber`
-- (`forma_pagamento = 'promissoria'`, mesmo rótulo que o Atacado já usa pra essa mesma ideia).
--
-- `cliente_tem_atraso_fiado` (function nova): dá o aviso (não bloqueio) de atraso no PDV -- SECURITY
-- DEFINER porque `contas_receber` só é legível direto por admin/financeiro via RLS, e quem roda o
-- PDV é vendedor; devolve só um sinal (atrasado/valor/dias), não a tabela inteira.
--
-- NÃO MUDA: `dar_baixa_em_lote_contas_receber`, `autorizar_acao` (só ganha um item na whitelist,
-- resto idêntico), RLS de `contas_receber` (a tela /varejo/crediario, admin-only, já se encaixa no
-- "admin ou financeiro" que a policy já libera).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Bloqueia se já existir alguma parcela fiado lançada de verdade (venda_id preenchido
-- -- em contas_receber) -- nesse caso o jeito é manter a feature em vez de reverter.
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

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  alter table public.contas_receber add column venda_id uuid references public.vendas (id) on delete set null;
  alter table public.contas_receber add constraint contas_receber_origem_check
    check (num_nonnulls(pedido_id, venda_id) = 1);

  -- autorizacoes_pontuais.acao tem um CHECK proprio, separado da whitelist dentro de autorizar_acao()
  -- -- achado rodando este ensaio ("violates check constraint autorizacoes_pontuais_acao_check"):
  -- atualizar só a function não bastava, o banco também bloqueava no INSERT.
  alter table public.autorizacoes_pontuais drop constraint autorizacoes_pontuais_acao_check;
  alter table public.autorizacoes_pontuais add constraint autorizacoes_pontuais_acao_check
    check (acao = any (array['desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo', 'venda_fiado']));

  create or replace function public.autorizar_acao(p_acao text, p_supervisor_id uuid, p_pin text, p_alvo_id uuid default null::uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_sv public.supervisores%rowtype;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    if v_op is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    if p_acao not in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo', 'venda_fiado') then
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
  $$;

  -- CREATE OR REPLACE com parametros NOVOS no final (mesmo com default) NAO substitui a function
  -- antiga -- cria uma SEGUNDA function (mesmo nome, assinatura diferente) coexistindo com a
  -- original, que fica orfa mas continua existindo. Achado rodando este ensaio (o $cmp$ final
  -- acusou "rollback nao devolveu o schema ao estado original" -- as duas assinaturas antigas, de 11
  -- e 14 parametros, nunca tinham sumido). Mesma regra de sempre pra mudanca de assinatura: DROP da
  -- assinatura antiga exata + CREATE da nova + re-GRANT (grants nao sobrevivem a um DROP).
  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid);

  create function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid,
    p_parcelas_fiado jsonb default null::jsonb, p_autorizacao_fiado_id uuid default null::uuid
  ) returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_s public.caixa_sessoes%rowtype;
    v_dep uuid;
    v_id uuid;
    v_numero bigint;
    v_item jsonb;
    v_pag jsonb;
    v_var uuid;
    v_desc_manual text;
    v_qtd integer;
    v_tab numeric;
    v_min numeric;
    v_piso numeric;
    v_prat numeric;
    v_custo numeric;
    v_desp_var numeric;
    v_piso_prejuizo numeric;
    v_saldo bigint;
    v_item_id uuid;
    v_cod_atacado numeric;
    v_fator_atacado numeric;
    v_divida_custo_unit numeric;
    v_divida_custo_total numeric;
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
    v_parcela jsonb;
    v_indice integer;
    v_valor_parcela numeric;
    v_venc date;
    v_soma_fiado numeric := 0;
    v_num_parcelas_fiado integer := 0;
    v_sup_fiado uuid;
    v_total_a_pagar_agora numeric;
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
    if p_pagamentos is null or jsonb_typeof(p_pagamentos) <> 'array' then
      raise exception 'A venda precisa de ao menos um pagamento';
    end if;
    if p_parcelas_fiado is not null and jsonb_typeof(p_parcelas_fiado) <> 'array' then
      raise exception 'Parcelas fiado invalidas';
    end if;
    -- Venda fiado (2026-10-28) pode cobrir o total inteiro -- diferente de antes, p_pagamentos
    -- pode vir vazio DESDE QUE existam parcelas fiado cobrindo a venda (checado mais abaixo).
    if jsonb_array_length(p_pagamentos) = 0 and coalesce(jsonb_array_length(p_parcelas_fiado), 0) = 0 then
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
      v_desc_manual := nullif(trim(v_item ->> 'descricao_manual'), '');
      v_qtd := (v_item ->> 'quantidade')::integer;
      if v_qtd is null or v_qtd <= 0 then
        raise exception 'Quantidade invalida';
      end if;
      if v_var is not null and v_desc_manual is not null then
        raise exception 'Item nao pode ter variacao de catalogo e descricao manual ao mesmo tempo';
      end if;

      -- Item manual (fora do catalogo, 2026-10-24): sem preco de tabela/minimo, sem custo
      -- conhecido, sem estoque pra baixar -- o vendedor digita o preco combinado na hora. Por
      -- desenho, NUNCA entra em v_abaixo/v_estoque_insuf -- nunca exige PIN de supervisor (decisao
      -- explicita do usuario: o fechamento de caixa no fim do dia ja pega qualquer divergencia).
      if v_desc_manual is not null then
        v_prat := public.arredondar_moeda(nullif(v_item ->> 'preco_unitario', '')::numeric);
        if v_prat is null or v_prat <= 0 then
          raise exception 'Informe o preco do item manual "%"', v_desc_manual;
        end if;

        insert into public.venda_itens (venda_id, descricao_manual, quantidade, preco_tabela, preco_unitario, custo_unitario)
        values (v_id, v_desc_manual, v_qtd, v_prat, v_prat, 0)
        returning id into v_item_id;

        v_subtotal := v_subtotal + public.arredondar_moeda(v_prat * v_qtd);
        v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);

        -- Codigo do Atacado pro item manual (2026-10-26, pedido do usuario): digitado no PDV junto
        -- com descricao/preco -- NAO afeta v_prat/preco cobrado do cliente, so vira divida.
        v_cod_atacado := nullif(v_item ->> 'codigo_atacado', '')::numeric;
        if v_cod_atacado is not null then
          if v_cod_atacado <= 0 then
            raise exception 'Codigo do Atacado deve ser maior que zero';
          end if;
          v_fator_atacado := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
          v_divida_custo_unit := public.arredondar_moeda(v_cod_atacado * v_fator_atacado);
          v_divida_custo_total := public.arredondar_moeda(v_divida_custo_unit * v_qtd);
          insert into public.varejo_dividas_atacado
            (venda_item_id, codigo_atacado, fator_custo, quantidade, custo_unitario, custo_total, status)
          values
            (v_item_id, v_cod_atacado, v_fator_atacado, v_qtd, v_divida_custo_unit, v_divida_custo_total, 'em_aberto');
        end if;

        continue;
      end if;

      select cv.preco_venda, cv.preco_minimo, cv.codigo_atacado into v_tab, v_min, v_cod_atacado
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
      values (v_id, v_var, v_qtd, v_tab, v_prat, v_custo)
      returning id into v_item_id;

      v_subtotal := v_subtotal + public.arredondar_moeda(v_tab * v_qtd);
      v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);

      -- Codigo do Atacado da PECA (2026-10-26): lido automaticamente do catalogo (metadado salvo no
      -- cadastro) -- o vendedor nunca digita isso no PDV pra peca ja cadastrada. So gera divida
      -- AGORA, na venda -- cadastrar a peca nunca gera divida nenhuma.
      if v_cod_atacado is not null then
        v_fator_atacado := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
        v_divida_custo_unit := public.arredondar_moeda(v_cod_atacado * v_fator_atacado);
        v_divida_custo_total := public.arredondar_moeda(v_divida_custo_unit * v_qtd);
        insert into public.varejo_dividas_atacado
          (variacao_id, venda_item_id, codigo_atacado, fator_custo, quantidade, custo_unitario, custo_total, status)
        values
          (v_var, v_item_id, v_cod_atacado, v_fator_atacado, v_qtd, v_divida_custo_unit, v_divida_custo_total, 'em_aberto');
      end if;
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

    -- Venda fiado/a prazo (2026-10-28, "como se fosse um crediario"): uma parcela (data unica) ou
    -- varias (ajustavel), cobrindo o total inteiro ou so o que sobra depois de uma entrada em
    -- p_pagamentos -- mesmo espirito do "misto" do Atacado (entrada + promissoria). Exige cliente
    -- (precisa saber de quem cobrar) e PIN de supervisor (decisao do usuario: mesmo risco financeiro
    -- de desconto abaixo do minimo/estoque negativo, que ja pedem autorizacao).
    if p_parcelas_fiado is not null and jsonb_array_length(p_parcelas_fiado) > 0 then
      if p_cliente_id is null then
        raise exception 'Venda fiado precisa de um cliente selecionado';
      end if;
      perform public.exigir_operacao('clientes', p_cliente_id);
      if p_autorizacao_fiado_id is null then
        raise exception 'Venda fiado exige autorizacao de supervisor';
      end if;
      v_sup_fiado := public.consumir_autorizacao(p_autorizacao_fiado_id, 'venda_fiado', p_sessao_id);

      v_num_parcelas_fiado := jsonb_array_length(p_parcelas_fiado);
      for v_parcela, v_indice in
        select e, ord::integer from jsonb_array_elements(p_parcelas_fiado) with ordinality as t(e, ord)
      loop
        v_valor_parcela := public.arredondar_moeda((v_parcela ->> 'valor')::numeric);
        v_venc := nullif(v_parcela ->> 'vencimento', '')::date;
        if v_valor_parcela is null or v_valor_parcela <= 0 then
          raise exception 'Valor de parcela fiado invalido';
        end if;
        if v_venc is null then
          raise exception 'Informe o vencimento de cada parcela fiado';
        end if;
        if v_venc < current_date then
          raise exception 'Vencimento da parcela fiado nao pode ser no passado';
        end if;
        v_soma_fiado := v_soma_fiado + v_valor_parcela;
        insert into public.contas_receber (venda_id, cliente_id, valor, vencimento, forma_pagamento, numero_parcela, total_parcelas)
        values (v_id, p_cliente_id, v_valor_parcela, v_venc, 'promissoria', v_indice, v_num_parcelas_fiado);
      end loop;

      if v_soma_fiado > v_total_final then
        raise exception 'Soma das parcelas fiado maior que o total da venda';
      end if;

      perform public.registrar_auditoria('vendas', v_id, 'venda_fiado', null,
        jsonb_build_object('cliente_id', p_cliente_id, 'parcelas', p_parcelas_fiado, 'autorizado_por', v_sup_fiado, 'total_parcelado', v_soma_fiado), null);
    end if;

    -- O que precisa ser coberto AGORA por p_pagamentos e o total menos o que ficou parcelado --
    -- sem fiado nenhum (v_soma_fiado = 0), e exatamente o total inteiro, igual sempre foi.
    v_total_a_pagar_agora := v_total_final - v_soma_fiado;

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
    if v_soma < v_total_a_pagar_agora then
      raise exception 'Pagamento insuficiente';
    end if;
    v_troco := v_soma - v_total_a_pagar_agora;
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
  $$;

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid) from public, anon;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid) to authenticated;

  -- registrar_venda_varejo_com_cashback e quem o app chama de verdade (nunca registrar_venda
  -- direto) -- so repassa pra ela, com cashback/cupom por cima. Precisa dos 2 parametros novos
  -- tambem, repassados direto, senao o fiado nunca chegaria em registrar_venda vindo do app. Mesmo
  -- motivo do DROP+CREATE acima: CREATE OR REPLACE com assinatura diferente nao substitui a antiga.
  drop function if exists public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid);

  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid, p_cashback_resgatar_id uuid default null::uuid,
    p_conceder_cashback boolean default false, p_cupom_id uuid default null::uuid,
    p_parcelas_fiado jsonb default null::jsonb, p_autorizacao_fiado_id uuid default null::uuid
  ) returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_venda_id uuid;
    v_valor_resgatado numeric;
    v_cupom public.cupons_varejo%rowtype;
    v_cpf text;
    v_subtotal_venda numeric;
    v_desconto_cupom numeric;
  begin
    v_venda_id := public.registrar_venda(
      p_sessao_id, p_itens, p_pagamentos, p_idempotency_key,
      p_cliente_nome, p_cliente_documento, p_autorizacao_desconto_id, p_autorizacao_estoque_id,
      p_valor_desconto, p_valor_acrescimo, p_cliente_id, p_parcelas_fiado, p_autorizacao_fiado_id
    );

    if p_cupom_id is not null then
      if p_cliente_id is null then
        raise exception 'Selecione o cliente para usar um cupom';
      end if;

      select * into v_cupom from public.cupons_varejo where id = p_cupom_id and operacao_id = v_op;
      if not found then
        raise exception 'Cupom nao encontrado';
      end if;
      if not v_cupom.ativo then
        raise exception 'Esse cupom esta desativado';
      end if;
      if v_cupom.validade < (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'Esse cupom ja venceu';
      end if;

      select cpf_cnpj into v_cpf from public.clientes where id = p_cliente_id;
      if v_cpf is null or trim(v_cpf) = '' then
        raise exception 'Cliente sem CPF/CNPJ cadastrado -- nao e possivel aplicar cupom';
      end if;

      select subtotal into v_subtotal_venda from public.vendas where id = v_venda_id;
      v_desconto_cupom := case v_cupom.tipo
        when 'percentual' then public.arredondar_moeda(v_subtotal_venda * v_cupom.valor / 100)
        else public.arredondar_moeda(v_cupom.valor)
      end;
      if p_valor_desconto < v_desconto_cupom then
        raise exception 'O desconto da venda (%) e menor que o desconto do cupom (%) -- o cliente precisa receber o valor do cupom como desconto', p_valor_desconto, v_desconto_cupom;
      end if;

      begin
        insert into public.cupons_varejo_usos (cupom_id, cliente_id, venda_id, operacao_id)
        values (p_cupom_id, p_cliente_id, v_venda_id, v_op);
      exception
        when unique_violation then
          raise exception 'Esse cliente ja usou este cupom';
      end;
    end if;

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
  $$;

  revoke execute on function public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid) to authenticated;

  -- Aviso (nao bloqueio -- decisao do usuario) de atraso no PDV: contas_receber so e legivel direto
  -- por admin/financeiro via RLS, mas quem roda o PDV e vendedor -- devolve so um sinal, nao a
  -- tabela inteira.
  create function public.cliente_tem_atraso_fiado(p_cliente_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_r record;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    if p_cliente_id is null then
      return jsonb_build_object('atrasado', false);
    end if;
    select cr.valor, cr.vencimento into v_r
      from public.contas_receber cr
     where cr.cliente_id = p_cliente_id and cr.venda_id is not null and cr.operacao_id = v_op
       and cr.situacao <> 'pago' and cr.vencimento < current_date
     order by cr.vencimento asc
     limit 1;
    if not found then
      return jsonb_build_object('atrasado', false);
    end if;
    return jsonb_build_object('atrasado', true, 'valor', v_r.valor, 'dias', (current_date - v_r.vencimento));
  end
  $$;

  revoke execute on function public.cliente_tem_atraso_fiado(uuid) from public, anon;
  grant execute on function public.cliente_tem_atraso_fiado(uuid) to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contas_receber' and column_name = 'venda_id'
  ) then
    raise exception 'FALHA: contas_receber.venda_id nao existe';
  end if;
  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid)') is null then
    raise exception 'FALHA: registrar_venda com parcelas fiado nao existe';
  end if;
  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid)') is null then
    raise exception 'FALHA: registrar_venda_varejo_com_cashback com parcelas fiado nao existe';
  end if;
  if to_regprocedure('public.cliente_tem_atraso_fiado(uuid)') is null then
    raise exception 'FALHA: cliente_tem_atraso_fiado nao existe';
  end if;

  raise notice 'VERIFICACAO OK: contas_receber.venda_id, registrar_venda/registrar_venda_varejo_com_cashback com fiado, cliente_tem_atraso_fiado no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_varejo uuid;
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod1 uuid;
  v_var1 uuid;
  v_cliente uuid;
  v_autorizacao uuid;
  v_venda uuid;
  v_n int;
  v_total_parcelado numeric;
  v_resultado jsonb;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  v_prod1 := public.cadastrar_produto_catalogo('ZZ ENSAIO FIADO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZFIADO1', 'atributos', '{}'::jsonb, 'preco_venda', 300.00)));
  select id into v_var1 from public.catalogo_variacoes where produto_id = v_prod1;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var1, 10, 50.00, 'ensaio venda fiado');

  -- operacao_id NUNCA vai explicito (trg_carimbar_operacao bloqueia e preenche sozinho a partir
  -- da sessao) -- achado rodando este ensaio: "operacao_id nao pode ser informado".
  insert into public.clientes (nome) values ('ZZ ENSAIO CLIENTE FIADO') returning id into v_cliente;

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- T1. Sem autorizacao -> bloqueado. Chama o WRAPPER (registrar_venda_varejo_com_cashback) em
  -- todos os testes, nao registrar_venda direto -- e o que o app de verdade chama.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
      '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
      null, false, null,
      jsonb_build_array(jsonb_build_object('valor', 300.00, 'vencimento', (current_date + 30)::text)),
      null
    );
    raise exception 'TESTE FALHOU [T1]: fiado sem autorizacao deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'exige autorizacao de supervisor' then raise; end if;
  end;

  -- T2. Sem cliente -> bloqueado (mesmo com autorizacao). Fixture (insert direto em
  -- autorizacoes_pontuais) roda fora do role authenticated -- de proposito, `authenticated` nao
  -- tem INSERT nessa tabela (so a function autorizar_acao escreve nela); achado rodando este ensaio.
  execute 'reset role';
  insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
    values ('venda_fiado', v_lucas, v_lucas, v_sessao, now() + interval '5 minutes') returning id into v_autorizacao;
  execute 'set local role authenticated';
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
      '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, null,
      null, false, null,
      jsonb_build_array(jsonb_build_object('valor', 300.00, 'vencimento', (current_date + 30)::text)),
      v_autorizacao
    );
    raise exception 'TESTE FALHOU [T2]: fiado sem cliente deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'precisa de um cliente selecionado' then raise; end if;
  end;

  -- T3. Fiado puro (sem entrada), 1 parcela = total inteiro -> aceita, cria 1 linha em
  -- contas_receber ligada a venda_id, sem venda_pagamentos nenhum.
  execute 'reset role';
  insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
    values ('venda_fiado', v_lucas, v_lucas, v_sessao, now() + interval '5 minutes') returning id into v_autorizacao;
  execute 'set local role authenticated';
  v_venda := public.registrar_venda_varejo_com_cashback(
    v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
    '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
    null, false, null,
    jsonb_build_array(jsonb_build_object('valor', 300.00, 'vencimento', (current_date + 30)::text)),
    v_autorizacao
  );
  select count(*) into v_n from public.venda_pagamentos where venda_id = v_venda;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T3]: fiado puro nao deveria ter venda_pagamentos'; end if;
  select count(*), sum(valor) into v_n, v_total_parcelado from public.contas_receber where venda_id = v_venda;
  if v_n <> 1 or v_total_parcelado <> 300.00 then
    raise exception 'TESTE FALHOU [T3]: esperava 1 parcela de 300.00, achou % parcelas somando %', v_n, v_total_parcelado;
  end if;
  if not exists (select 1 from public.contas_receber where venda_id = v_venda and pedido_id is null and forma_pagamento = 'promissoria' and situacao = 'em_dia') then
    raise exception 'TESTE FALHOU [T3]: parcela fiado nao nasceu com os campos esperados';
  end if;

  -- T4. Entrada em dinheiro (100) + 2 parcelas (100 + 100) cobrindo o resto de uma venda de 300 ->
  -- aceita, troco zero, 2 parcelas de 100 cada.
  execute 'reset role';
  insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
    values ('venda_fiado', v_lucas, v_lucas, v_sessao, now() + interval '5 minutes') returning id into v_autorizacao;
  execute 'set local role authenticated';
  v_venda := public.registrar_venda_varejo_com_cashback(
    v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
    gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
    null, false, null,
    jsonb_build_array(
      jsonb_build_object('valor', 100.00, 'vencimento', (current_date + 30)::text),
      jsonb_build_object('valor', 100.00, 'vencimento', (current_date + 60)::text)
    ),
    v_autorizacao
  );
  select troco into v_total_parcelado from public.vendas where id = v_venda;
  if v_total_parcelado <> 0 then raise exception 'TESTE FALHOU [T4]: troco deveria ser zero, veio %', v_total_parcelado; end if;
  select count(*) into v_n from public.contas_receber where venda_id = v_venda;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T4]: esperava 2 parcelas, achou %', v_n; end if;
  if not exists (select 1 from public.contas_receber where venda_id = v_venda and numero_parcela = 1 and total_parcelas = 2)
     or not exists (select 1 from public.contas_receber where venda_id = v_venda and numero_parcela = 2 and total_parcelas = 2) then
    raise exception 'TESTE FALHOU [T4]: numero_parcela/total_parcelas nao gravados certo';
  end if;

  -- T5. Soma das parcelas maior que o total -> bloqueado.
  execute 'reset role';
  insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
    values ('venda_fiado', v_lucas, v_lucas, v_sessao, now() + interval '5 minutes') returning id into v_autorizacao;
  execute 'set local role authenticated';
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
      '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
      null, false, null,
      jsonb_build_array(jsonb_build_object('valor', 9999.00, 'vencimento', (current_date + 30)::text)),
      v_autorizacao
    );
    raise exception 'TESTE FALHOU [T5]: soma de parcelas maior que o total deveria ter sido bloqueada';
  exception
    when others then
      if sqlerrm !~ 'maior que o total da venda' then raise; end if;
  end;

  -- T6. autorizar_acao aceita 'venda_fiado' na whitelist (nao cai mais em "Acao nao suportada" --
  -- falha so por supervisor_id invalido, que e o esperado sem um supervisor de verdade configurado).
  v_resultado := public.autorizar_acao('venda_fiado', gen_random_uuid(), '0000', v_sessao);
  if (v_resultado ->> 'motivo') = 'Acao nao suportada' then
    raise exception 'TESTE FALHOU [T6]: venda_fiado nao esta na whitelist de autorizar_acao';
  end if;

  -- T7. cliente_tem_atraso_fiado detecta a parcela de T3/T4 como NAO atrasada ainda (vencimento no
  -- futuro) -- so pra confirmar que a function roda sem erro e devolve o formato esperado.
  v_resultado := public.cliente_tem_atraso_fiado(v_cliente);
  if (v_resultado ->> 'atrasado')::boolean is distinct from false then
    raise exception 'TESTE FALHOU [T7]: cliente sem parcela vencida nao deveria aparecer como atrasado';
  end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T7 (bloqueios de autorizacao/cliente/soma, fiado puro, entrada+parcelas, whitelist, aviso de atraso).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  -- So checa dado real em modo 'desfazer' de verdade -- em 'ensaio', o $teste$ acima acabou de criar
  -- parcelas fiado de teste na MESMA transacao, e isso NAO pode disparar o bloqueio.
  if current_setting('app.modo_migration', true) = 'desfazer' then
    if exists (select 1 from public.contas_receber where venda_id is not null) then
      raise exception 'DESFAZER BLOQUEADO: ja existe parcela fiado lancada de verdade (venda_id preenchido) -- desfazer perderia esse dado. Mantenha a feature em vez de reverter.';
    end if;
  else
    delete from public.contas_receber where venda_id is not null;
  end if;

  drop function if exists public.cliente_tem_atraso_fiado(uuid);

  -- Mesmo motivo do $up$: DROP da assinatura com fiado (13 params) + CREATE da assinatura antiga
  -- (11 params) -- CREATE OR REPLACE nao apaga a versao com mais parametros.
  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid);

  create function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid
  ) returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_s public.caixa_sessoes%rowtype;
    v_dep uuid;
    v_id uuid;
    v_numero bigint;
    v_item jsonb;
    v_pag jsonb;
    v_var uuid;
    v_desc_manual text;
    v_qtd integer;
    v_tab numeric;
    v_min numeric;
    v_piso numeric;
    v_prat numeric;
    v_custo numeric;
    v_desp_var numeric;
    v_piso_prejuizo numeric;
    v_saldo bigint;
    v_item_id uuid;
    v_cod_atacado numeric;
    v_fator_atacado numeric;
    v_divida_custo_unit numeric;
    v_divida_custo_total numeric;
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

    select vc.despesas_variaveis_pct into v_desp_var from public.varejo_config vc
     where vc.operacao_id = v_op and vc.vigente_desde <= current_date
     order by vc.vigente_desde desc limit 1;
    if v_desp_var is not null and v_desp_var >= 1 then
      raise exception 'Configuracao financeira com despesas variaveis em 100%% ou mais -- nenhum preco cobre o custo, corrija a configuracao antes de vender';
    end if;

    for v_item in select e from jsonb_array_elements(p_itens) e loop
      v_var := (v_item ->> 'variacao_id')::uuid;
      v_desc_manual := nullif(trim(v_item ->> 'descricao_manual'), '');
      v_qtd := (v_item ->> 'quantidade')::integer;
      if v_qtd is null or v_qtd <= 0 then
        raise exception 'Quantidade invalida';
      end if;
      if v_var is not null and v_desc_manual is not null then
        raise exception 'Item nao pode ter variacao de catalogo e descricao manual ao mesmo tempo';
      end if;

      if v_desc_manual is not null then
        v_prat := public.arredondar_moeda(nullif(v_item ->> 'preco_unitario', '')::numeric);
        if v_prat is null or v_prat <= 0 then
          raise exception 'Informe o preco do item manual "%"', v_desc_manual;
        end if;

        insert into public.venda_itens (venda_id, descricao_manual, quantidade, preco_tabela, preco_unitario, custo_unitario)
        values (v_id, v_desc_manual, v_qtd, v_prat, v_prat, 0)
        returning id into v_item_id;

        v_subtotal := v_subtotal + public.arredondar_moeda(v_prat * v_qtd);
        v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);

        v_cod_atacado := nullif(v_item ->> 'codigo_atacado', '')::numeric;
        if v_cod_atacado is not null then
          if v_cod_atacado <= 0 then
            raise exception 'Codigo do Atacado deve ser maior que zero';
          end if;
          v_fator_atacado := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
          v_divida_custo_unit := public.arredondar_moeda(v_cod_atacado * v_fator_atacado);
          v_divida_custo_total := public.arredondar_moeda(v_divida_custo_unit * v_qtd);
          insert into public.varejo_dividas_atacado
            (venda_item_id, codigo_atacado, fator_custo, quantidade, custo_unitario, custo_total, status)
          values
            (v_item_id, v_cod_atacado, v_fator_atacado, v_qtd, v_divida_custo_unit, v_divida_custo_total, 'em_aberto');
        end if;

        continue;
      end if;

      select cv.preco_venda, cv.preco_minimo, cv.codigo_atacado into v_tab, v_min, v_cod_atacado
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
      values (v_id, v_var, v_qtd, v_tab, v_prat, v_custo)
      returning id into v_item_id;

      v_subtotal := v_subtotal + public.arredondar_moeda(v_tab * v_qtd);
      v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);

      if v_cod_atacado is not null then
        v_fator_atacado := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
        v_divida_custo_unit := public.arredondar_moeda(v_cod_atacado * v_fator_atacado);
        v_divida_custo_total := public.arredondar_moeda(v_divida_custo_unit * v_qtd);
        insert into public.varejo_dividas_atacado
          (variacao_id, venda_item_id, codigo_atacado, fator_custo, quantidade, custo_unitario, custo_total, status)
        values
          (v_var, v_item_id, v_cod_atacado, v_fator_atacado, v_qtd, v_divida_custo_unit, v_divida_custo_total, 'em_aberto');
      end if;
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
  $$;

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid) from public, anon;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid) to authenticated;

  drop function if exists public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid);

  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid, p_cashback_resgatar_id uuid default null::uuid,
    p_conceder_cashback boolean default false, p_cupom_id uuid default null::uuid
  ) returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_venda_id uuid;
    v_valor_resgatado numeric;
    v_cupom public.cupons_varejo%rowtype;
    v_cpf text;
    v_subtotal_venda numeric;
    v_desconto_cupom numeric;
  begin
    v_venda_id := public.registrar_venda(
      p_sessao_id, p_itens, p_pagamentos, p_idempotency_key,
      p_cliente_nome, p_cliente_documento, p_autorizacao_desconto_id, p_autorizacao_estoque_id,
      p_valor_desconto, p_valor_acrescimo, p_cliente_id
    );

    if p_cupom_id is not null then
      if p_cliente_id is null then
        raise exception 'Selecione o cliente para usar um cupom';
      end if;

      select * into v_cupom from public.cupons_varejo where id = p_cupom_id and operacao_id = v_op;
      if not found then
        raise exception 'Cupom nao encontrado';
      end if;
      if not v_cupom.ativo then
        raise exception 'Esse cupom esta desativado';
      end if;
      if v_cupom.validade < (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'Esse cupom ja venceu';
      end if;

      select cpf_cnpj into v_cpf from public.clientes where id = p_cliente_id;
      if v_cpf is null or trim(v_cpf) = '' then
        raise exception 'Cliente sem CPF/CNPJ cadastrado -- nao e possivel aplicar cupom';
      end if;

      select subtotal into v_subtotal_venda from public.vendas where id = v_venda_id;
      v_desconto_cupom := case v_cupom.tipo
        when 'percentual' then public.arredondar_moeda(v_subtotal_venda * v_cupom.valor / 100)
        else public.arredondar_moeda(v_cupom.valor)
      end;
      if p_valor_desconto < v_desconto_cupom then
        raise exception 'O desconto da venda (%) e menor que o desconto do cupom (%) -- o cliente precisa receber o valor do cupom como desconto', p_valor_desconto, v_desconto_cupom;
      end if;

      begin
        insert into public.cupons_varejo_usos (cupom_id, cliente_id, venda_id, operacao_id)
        values (p_cupom_id, p_cliente_id, v_venda_id, v_op);
      exception
        when unique_violation then
          raise exception 'Esse cliente ja usou este cupom';
      end;
    end if;

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
  $$;

  revoke execute on function public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid) to authenticated;

  create or replace function public.autorizar_acao(p_acao text, p_supervisor_id uuid, p_pin text, p_alvo_id uuid default null::uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
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
  $$;

  -- Limpa autorizacoes efemeras de 'venda_fiado' (tokens de 5 minutos, consumidos ou nao -- nunca
  -- sao dado historico que vale preservar, diferente de parcela/divida) antes de devolver a
  -- constraint mais estreita -- achado rodando este ensaio: a constraint antiga rejeitava as linhas
  -- de teste que o $teste$ acabou de criar na mesma transacao.
  delete from public.autorizacoes_pontuais where acao = 'venda_fiado';
  alter table public.autorizacoes_pontuais drop constraint if exists autorizacoes_pontuais_acao_check;
  alter table public.autorizacoes_pontuais add constraint autorizacoes_pontuais_acao_check
    check (acao = any (array['desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo']));

  alter table public.contas_receber drop constraint if exists contas_receber_origem_check;
  alter table public.contas_receber drop column if exists venda_id;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contas_receber' and column_name = 'venda_id'
  ) or to_regprocedure('public.cliente_tem_atraso_fiado(uuid)') is not null
    or to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid)') is not null
    or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid)') is not null then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: venda fiado/a prazo testada (T1 a T7) e desfeita -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
