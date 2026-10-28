-- Venda fiado/a prazo deixa de exigir PIN de supervisor -- pedido do usuario, 2026-10-28, revendo
-- a decisao de algumas horas atras (migration 20261028000001). Fica livre pro vendedor, igual o
-- item manual ja e hoje (decisao original do item manual: "o fechamento de caixa no fim do dia ja
-- pega qualquer divergencia").
--
-- `registrar_venda`/`registrar_venda_varejo_com_cashback` perdem o parametro `p_autorizacao_fiado_id`
-- (13 -> 12 params / 16 -> 15 params) e o bloqueio "Venda fiado exige autorizacao de supervisor" +
-- a chamada a `consumir_autorizacao(..., 'venda_fiado', ...)`. CREATE OR REPLACE com assinatura
-- diferente NAO substitui a antiga (achado na migration anterior) -- DROP+CREATE+GRANT de novo.
-- Continua exigindo cliente selecionado (precisa saber de quem cobrar) -- isso nao mudou.
--
-- `autorizar_acao` perde 'venda_fiado' da whitelist (CREATE OR REPLACE, assinatura igual) e
-- `autorizacoes_pontuais_acao_check` volta pra 4 valores -- a acao nunca mais e usada por ninguem.
--
-- NAO MUDA: aviso (nao bloqueio) de atraso continua igual; tela /varejo/crediario continua igual;
-- contas_receber.venda_id continua igual.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Devolve a exigencia de PIN -- seguro reverter a qualquer momento (nao mexe em dado
-- -- nenhum, so na regra de quem pode vender fiado).
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

  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid);

  create function public.registrar_venda(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid,
    p_parcelas_fiado jsonb default null::jsonb
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
    if jsonb_array_length(p_pagamentos) = 0 and coalesce(jsonb_array_length(p_parcelas_fiado), 0) = 0 then
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

    -- Venda fiado/a prazo (2026-10-28, revisao: deixou de exigir PIN de supervisor -- livre pro
    -- vendedor, igual o item manual ja e hoje). Continua exigindo cliente selecionado (precisa
    -- saber de quem cobrar depois) -- isso nao mudou.
    if p_parcelas_fiado is not null and jsonb_array_length(p_parcelas_fiado) > 0 then
      if p_cliente_id is null then
        raise exception 'Venda fiado precisa de um cliente selecionado';
      end if;
      perform public.exigir_operacao('clientes', p_cliente_id);

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
        jsonb_build_object('cliente_id', p_cliente_id, 'parcelas', p_parcelas_fiado, 'total_parcelado', v_soma_fiado), null);
    end if;

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

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb) from public, anon;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb) to authenticated;

  drop function if exists public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid);

  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid, p_cashback_resgatar_id uuid default null::uuid,
    p_conceder_cashback boolean default false, p_cupom_id uuid default null::uuid,
    p_parcelas_fiado jsonb default null::jsonb
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
      p_valor_desconto, p_valor_acrescimo, p_cliente_id, p_parcelas_fiado
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

  revoke execute on function public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb) to authenticated;

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

  -- autorizacoes_pontuais de 'venda_fiado' que ja existiam (da migration anterior) deixam de fazer
  -- sentido -- nenhuma acao nova nasce com esse valor a partir de agora, e a constraint mais
  -- estreita abaixo rejeitaria linha residual, se houvesse.
  delete from public.autorizacoes_pontuais where acao = 'venda_fiado';
  alter table public.autorizacoes_pontuais drop constraint if exists autorizacoes_pontuais_acao_check;
  alter table public.autorizacoes_pontuais add constraint autorizacoes_pontuais_acao_check
    check (acao = any (array['desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo']));
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb)') is null then
    raise exception 'FALHA: registrar_venda sem autorizacao_fiado nao existe';
  end if;
  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid)') is not null then
    raise exception 'FALHA: assinatura antiga de registrar_venda (com autorizacao_fiado) ainda existe';
  end if;
  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb)') is null then
    raise exception 'FALHA: registrar_venda_varejo_com_cashback sem autorizacao_fiado nao existe';
  end if;
  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid)') is not null then
    raise exception 'FALHA: assinatura antiga do wrapper (com autorizacao_fiado) ainda existe';
  end if;

  raise notice 'VERIFICACAO OK: registrar_venda/wrapper sem p_autorizacao_fiado_id, so 1 assinatura cada.';
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
  v_venda uuid;
  v_n int;
  v_total_parcelado numeric;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  v_prod1 := public.cadastrar_produto_catalogo('ZZ ENSAIO FIADO SEM PIN', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZFIADO2', 'atributos', '{}'::jsonb, 'preco_venda', 200.00)));
  select id into v_var1 from public.catalogo_variacoes where produto_id = v_prod1;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var1, 10, 50.00, 'ensaio fiado sem pin');

  insert into public.clientes (nome) values ('ZZ ENSAIO CLIENTE FIADO SEM PIN') returning id into v_cliente;

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- T1. Fiado SEM nenhuma autorizacao -> agora aceita de primeira (era bloqueado antes desta
  -- migration). So 1 parcela cobrindo o total inteiro.
  v_venda := public.registrar_venda_varejo_com_cashback(
    v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
    '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
    null, false, null,
    jsonb_build_array(jsonb_build_object('valor', 200.00, 'vencimento', (current_date + 30)::text))
  );
  select count(*), sum(valor) into v_n, v_total_parcelado from public.contas_receber where venda_id = v_venda;
  if v_n <> 1 or v_total_parcelado <> 200.00 then
    raise exception 'TESTE FALHOU [T1]: esperava 1 parcela de 200.00, achou % parcelas somando %', v_n, v_total_parcelado;
  end if;

  -- T2. Continua exigindo cliente -- isso NAO mudou.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
      '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, null,
      null, false, null,
      jsonb_build_array(jsonb_build_object('valor', 200.00, 'vencimento', (current_date + 30)::text))
    );
    raise exception 'TESTE FALHOU [T2]: fiado sem cliente deveria continuar bloqueado';
  exception
    when others then
      if sqlerrm !~ 'precisa de um cliente selecionado' then raise; end if;
  end;

  -- T3. Soma das parcelas maior que o total -- continua bloqueado.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 1)),
      '[]'::jsonb, gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
      null, false, null,
      jsonb_build_array(jsonb_build_object('valor', 9999.00, 'vencimento', (current_date + 30)::text))
    );
    raise exception 'TESTE FALHOU [T3]: soma de parcelas maior que o total deveria continuar bloqueada';
  exception
    when others then
      if sqlerrm !~ 'maior que o total da venda' then raise; end if;
  end;

  -- T4. autorizar_acao NAO aceita mais 'venda_fiado' na whitelist (voltou pro estado original).
  begin
    perform public.autorizar_acao('venda_fiado', gen_random_uuid(), '0000', v_sessao);
    raise exception 'TESTE FALHOU [T4]: venda_fiado nao deveria mais estar na whitelist de autorizar_acao';
  exception
    when others then
      if sqlerrm !~ 'Acao nao suportada' then raise; end if;
  end;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T4 (fiado sem autorizacao aceita, cliente continua obrigatorio, soma maior que total bloqueia, venda_fiado fora da whitelist de autorizar_acao).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb);

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
    if jsonb_array_length(p_pagamentos) = 0 and coalesce(jsonb_array_length(p_parcelas_fiado), 0) = 0 then
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

  drop function if exists public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb);

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

  alter table public.autorizacoes_pontuais drop constraint if exists autorizacoes_pontuais_acao_check;
  alter table public.autorizacoes_pontuais add constraint autorizacoes_pontuais_acao_check
    check (acao = any (array['desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo', 'venda_fiado']));
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb)') is not null
    or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb)') is not null
    or to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, jsonb, uuid)') is null
    or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid, jsonb, uuid)') is null then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: venda fiado sem PIN testada (T1 a T4) e desfeita -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
