-- Item manual no PDV Varejo: vender algo fora do catálogo, no ato da venda, digitando o nome e o
-- preço na hora -- pedido do usuário, 2026-10-24 ("corrente prata", algo que ainda não foi
-- cadastrado como peça). Perguntado se deveria exigir PIN de supervisor (mesmo tratamento de
-- desconto abaixo do mínimo/estoque negativo) -- respondeu que não, livre pro vendedor, o
-- fechamento de caixa no fim do dia já pega qualquer divergência de dinheiro.
--
-- `venda_itens.variacao_id` vira NULLABLE e ganha a coluna `descricao_manual text` -- uma linha é
-- SEMPRE uma coisa OU outra, nunca as duas nem nenhuma (constraint `num_nonnulls = 1`). Item manual
-- não tem preço de tabela/mínimo pra comparar (preco_tabela = preco_unitario, sem conceito de
-- desconto), não tem custo conhecido (custo_unitario = 0 -- SIM, isso infla a margem aparente no
-- Financeiro do Varejo pra essas vendas; aceito, não tem custo real pra registrar) e não baixa
-- estoque nenhum (não existe linha de estoque pra ele).
--
-- `registrar_venda` ganha um `continue` dentro do loop de itens pro ramo manual -- pula inteiro o
-- bloco de catálogo/piso/estoque/custo que vem depois (nunca entra em v_abaixo nem v_estoque_insuf,
-- então nunca exige autorização de supervisor, por desenho). NÃO virou uma function nova: é o
-- MESMO item de sempre, só que sem variacao_id -- forçaria duplicar toda a lógica de desconto do
-- carrinho/pagamento/troco pra ter uma "registrar_venda_item_manual" separada.
--
-- `cancelar_venda` precisa de UM ajuste (`and i.variacao_id is not null` na devolução de estoque) --
-- sem isso, cancelar uma venda com item manual tentava devolver estoque de uma variação que não
-- existe (null), e o INSERT em estoque_movimentos quebraria (variacao_id lá é NOT NULL).
--
-- `pdv_venda_itens` (view, hoje sem nenhum consumidor em código -- achado ao investigar) tinha
-- INNER JOIN até catalogo_variacoes/catalogo_produtos -- um item manual simplesmente DESAPARECIA da
-- lista da própria venda (o total continuaria certo, só o item ficaria invisível). Trocado pra LEFT
-- JOIN com `coalesce(produto.nome, descricao_manual)`.
--
-- NÃO muda `relatorio_varejo_dashboard`: `faturamento_diario`/`formas_pagamento` leem de
-- `vendas`/`venda_pagamentos` direto (já incluem o valor do item manual, embutido em vendas.total);
-- `top_produtos` faz INNER JOIN até catalogo_produtos de propósito -- um item manual não é um
-- "produto do catálogo", é correto ele não aparecer nesse ranking específico.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Remove a constraint/coluna nova de venda_itens, devolve registrar_venda/cancelar_venda
-- -- e a view pdv_venda_itens pro estado anterior. BLOQUEIA o desfazer se já existir alguma venda
-- -- real com item manual (perderia dado) -- nesse caso o jeito é manter a feature.
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

  alter table public.venda_itens alter column variacao_id drop not null;
  alter table public.venda_itens add column descricao_manual text;
  alter table public.venda_itens add constraint venda_itens_variacao_ou_manual
    check (num_nonnulls(variacao_id, descricao_manual) = 1);

  drop function if exists public.registrar_venda(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid
  );

  create function public.registrar_venda(
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
        values (v_id, v_desc_manual, v_qtd, v_prat, v_prat, 0);

        v_subtotal := v_subtotal + public.arredondar_moeda(v_prat * v_qtd);
        v_total := v_total + public.arredondar_moeda(v_prat * v_qtd);
        continue;
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

  revoke execute on function public.registrar_venda(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid
  ) from public, anon;
  grant execute on function public.registrar_venda(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid
  ) to authenticated;

  create or replace function public.cancelar_venda(p_venda_id uuid, p_motivo text, p_autorizacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_v public.vendas%rowtype;
    v_s public.caixa_sessoes%rowtype;
    v_sup uuid;
    v_dinheiro numeric;
    v_mov uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_motivo is null or length(trim(p_motivo)) = 0 then
      raise exception 'Motivo do cancelamento e obrigatorio';
    end if;
    select * into v_v from public.vendas where id = p_venda_id and operacao_id = v_op for update;
    if not found then
      raise exception 'Venda nao encontrada';
    end if;
    if v_v.status <> 'concluida' then
      raise exception 'Venda ja cancelada';
    end if;
    select * into v_s from public.caixa_sessoes where id = v_v.sessao_id and operacao_id = v_op for update;
    if v_s.status <> 'aberta' or v_s.operador_id <> auth.uid() then
      raise exception 'Cancelamento so na sessao de caixa aberta, pelo proprio operador';
    end if;

    v_sup := public.consumir_autorizacao(p_autorizacao_id, 'cancelamento_venda', p_venda_id);

    -- Devolve ao estoque pelo custo ORIGINAL da venda (custo congelado), nao pelo custo de hoje.
    -- Item manual (2026-10-24) nunca baixou estoque nenhum -- "and i.variacao_id is not null"
    -- exclui essas linhas, sem isso o INSERT quebraria (variacao_id e NOT NULL em estoque_movimentos).
    insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, documento_tipo, documento_id, observacao, criado_por)
    select v_v.deposito_id, i.variacao_id, 'devolucao_venda', i.quantidade, i.custo_unitario, 'venda_cancelada', v_v.id, p_motivo, auth.uid()
      from public.venda_itens i where i.venda_id = v_v.id and i.variacao_id is not null;

    select coalesce(sum(m.valor), 0) into v_dinheiro from public.caixa_movimentos m
     where m.documento_id = v_v.id and m.tipo = 'venda_dinheiro';
    if v_dinheiro > 0 then
      insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, documento_id, autorizado_por, criado_por)
      values (v_v.sessao_id, 'estorno_dinheiro', v_dinheiro, 'Cancelamento da venda ' || v_v.numero, v_v.id, v_sup, auth.uid())
      returning id into v_mov;
      perform public.registrar_auditoria('caixa_movimentos', v_mov, 'estorno_dinheiro_caixa', null,
        jsonb_build_object('sessao_id', v_v.sessao_id, 'venda_id', v_v.id, 'valor', v_dinheiro, 'autorizado_por', v_sup), p_motivo);
    end if;

    update public.vendas
       set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(),
           cancelamento_autorizado_por = v_sup, motivo_cancelamento = p_motivo
     where id = v_v.id;

    perform public.registrar_auditoria('vendas', v_v.id, 'cancelamento_venda',
      jsonb_build_object('status', 'concluida', 'total', v_v.total),
      jsonb_build_object('status', 'cancelada', 'autorizado_por', v_sup), p_motivo);
  end
  $fn$;

  create or replace view public.pdv_venda_itens as
   select i.id,
      i.venda_id,
      i.variacao_id,
      coalesce(p.nome, i.descricao_manual) as nome,
      vv.sku,
      i.quantidade,
      i.preco_tabela,
      i.preco_unitario
     from public.venda_itens i
     join public.vendas v on v.id = i.venda_id and v.operacao_id = i.operacao_id
     join public.minha_sessao_caixa m on m.sessao_id = v.sessao_id
     left join public.catalogo_variacoes vv on vv.id = i.variacao_id and vv.operacao_id = i.operacao_id
     left join public.catalogo_produtos p on p.id = vv.produto_id and p.operacao_id = vv.operacao_id
    where i.operacao_id = public.operacao_atual();
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='venda_itens' and column_name='variacao_id' and is_nullable = 'NO') then
    raise exception 'FALHA: venda_itens.variacao_id continua NOT NULL';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='venda_itens' and column_name='descricao_manual') then
    raise exception 'FALHA: venda_itens.descricao_manual nao existe';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venda_itens_variacao_ou_manual') then
    raise exception 'FALHA: constraint venda_itens_variacao_ou_manual nao existe';
  end if;
  if to_regprocedure('public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid)') is null then
    raise exception 'FALHA: registrar_venda nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda';
  end if;

  raise notice 'VERIFICACAO OK: venda_itens.descricao_manual, constraint e registrar_venda/cancelar_venda/pdv_venda_itens atualizados.';
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
  v_venda1 uuid;
  v_venda2 uuid;
  v_item record;
  v_n int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO ITEM MANUAL', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZMANUAL', 'atributos', '{}'::jsonb, 'preco_venda', 100.00)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var, 10, 20.00, 'ensaio item manual');

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- T1. Venda SO com item manual (Corrente prata, qtd 1, R$150) -> sucesso.
  v_venda1 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('descricao_manual', 'Corrente prata', 'quantidade', 1, 'preco_unitario', 150.00)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 150.00)),
    gen_random_uuid()
  );
  select * into v_item from public.venda_itens where venda_id = v_venda1;
  if v_item.variacao_id is not null then raise exception 'TESTE FALHOU [T1]: item manual nao deveria ter variacao_id'; end if;
  if v_item.descricao_manual <> 'Corrente prata' then raise exception 'TESTE FALHOU [T1]: descricao_manual errada'; end if;
  if v_item.custo_unitario <> 0 then raise exception 'TESTE FALHOU [T1]: custo_unitario deveria ser 0'; end if;
  if (select total from public.vendas where id = v_venda1) <> 150.00 then raise exception 'TESTE FALHOU [T1]: total da venda errado'; end if;

  -- T2. Item manual SEM preco -> bloqueado.
  begin
    perform public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('descricao_manual', 'Pingente ouro', 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid()
    );
    raise exception 'TESTE FALHOU [T2]: item manual sem preco deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'Informe o preco do item manual' then raise; end if;
  end;

  -- T3. Item manual com preco <= 0 -> bloqueado.
  begin
    perform public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('descricao_manual', 'Pingente ouro', 'quantidade', 1, 'preco_unitario', 0)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid()
    );
    raise exception 'TESTE FALHOU [T3]: item manual com preco zero deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'Informe o preco do item manual' then raise; end if;
  end;

  -- T4. Venda MISTA (item de catalogo + item manual) -> total soma os dois, sem exigir autorizacao
  -- de supervisor nenhuma (o item de catalogo vende no preco de tabela, sem desconto).
  v_venda2 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(
      jsonb_build_object('variacao_id', v_var, 'quantidade', 1),
      jsonb_build_object('descricao_manual', 'Conserto de fecho', 'quantidade', 1, 'preco_unitario', 30.00)
    ),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 130.00)),
    gen_random_uuid()
  );
  select count(*) into v_n from public.venda_itens where venda_id = v_venda2;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T4]: esperava 2 itens na venda mista, achou %', v_n; end if;
  if (select total from public.vendas where id = v_venda2) <> 130.00 then raise exception 'TESTE FALHOU [T4]: total da venda mista errado'; end if;

  -- T5. Cancelar a venda mista -> sucesso (nao quebra tentando devolver estoque do item manual);
  -- so 1 movimento de devolucao (do item de catalogo), nao 2.
  declare
    v_json jsonb;
    v_n_devolucao int;
  begin
    perform public.definir_pin_supervisor(v_lucas, '1234');
    v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_venda2);
    perform public.cancelar_venda(v_venda2, 'ensaio item manual', (v_json ->> 'autorizacao_id')::uuid);
    select count(*) into v_n_devolucao from public.estoque_movimentos where documento_id = v_venda2 and tipo = 'devolucao_venda';
    if v_n_devolucao <> 1 then raise exception 'TESTE FALHOU [T5]: esperava 1 devolucao de estoque (so a do item de catalogo), achou %', v_n_devolucao; end if;
  end;

  -- T6. Item com variacao_id E descricao_manual juntos -> bloqueado.
  begin
    perform public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'descricao_manual', 'Corrente prata', 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid()
    );
    raise exception 'TESTE FALHOU [T6]: item com variacao_id e descricao_manual juntos deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'nao pode ter variacao de catalogo e descricao manual' then raise; end if;
  end;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T6 (item manual sozinho, sem preco bloqueia, preco zero bloqueia, venda mista soma certo, cancelamento nao quebra, nao aceita os dois juntos).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  if exists (select 1 from public.venda_itens where descricao_manual is not null) then
    raise exception 'DESFAZER BLOQUEADO: ja existe pelo menos uma venda real com item manual -- desfazer perderia esse dado. Mantenha a feature em vez de reverter.';
  end if;

  drop function if exists public.registrar_venda(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid
  );

  create function public.registrar_venda(
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

  revoke execute on function public.registrar_venda(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid
  ) from public, anon;
  grant execute on function public.registrar_venda(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid
  ) to authenticated;

  create or replace function public.cancelar_venda(p_venda_id uuid, p_motivo text, p_autorizacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_v public.vendas%rowtype;
    v_s public.caixa_sessoes%rowtype;
    v_sup uuid;
    v_dinheiro numeric;
    v_mov uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_motivo is null or length(trim(p_motivo)) = 0 then
      raise exception 'Motivo do cancelamento e obrigatorio';
    end if;
    select * into v_v from public.vendas where id = p_venda_id and operacao_id = v_op for update;
    if not found then
      raise exception 'Venda nao encontrada';
    end if;
    if v_v.status <> 'concluida' then
      raise exception 'Venda ja cancelada';
    end if;
    select * into v_s from public.caixa_sessoes where id = v_v.sessao_id and operacao_id = v_op for update;
    if v_s.status <> 'aberta' or v_s.operador_id <> auth.uid() then
      raise exception 'Cancelamento so na sessao de caixa aberta, pelo proprio operador';
    end if;

    v_sup := public.consumir_autorizacao(p_autorizacao_id, 'cancelamento_venda', p_venda_id);

    insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, documento_tipo, documento_id, observacao, criado_por)
    select v_v.deposito_id, i.variacao_id, 'devolucao_venda', i.quantidade, i.custo_unitario, 'venda_cancelada', v_v.id, p_motivo, auth.uid()
      from public.venda_itens i where i.venda_id = v_v.id;

    select coalesce(sum(m.valor), 0) into v_dinheiro from public.caixa_movimentos m
     where m.documento_id = v_v.id and m.tipo = 'venda_dinheiro';
    if v_dinheiro > 0 then
      insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, documento_id, autorizado_por, criado_por)
      values (v_v.sessao_id, 'estorno_dinheiro', v_dinheiro, 'Cancelamento da venda ' || v_v.numero, v_v.id, v_sup, auth.uid())
      returning id into v_mov;
      perform public.registrar_auditoria('caixa_movimentos', v_mov, 'estorno_dinheiro_caixa', null,
        jsonb_build_object('sessao_id', v_v.sessao_id, 'venda_id', v_v.id, 'valor', v_dinheiro, 'autorizado_por', v_sup), p_motivo);
    end if;

    update public.vendas
       set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(),
           cancelamento_autorizado_por = v_sup, motivo_cancelamento = p_motivo
     where id = v_v.id;

    perform public.registrar_auditoria('vendas', v_v.id, 'cancelamento_venda',
      jsonb_build_object('status', 'concluida', 'total', v_v.total),
      jsonb_build_object('status', 'cancelada', 'autorizado_por', v_sup), p_motivo);
  end
  $fn$;

  create or replace view public.pdv_venda_itens as
   select i.id,
      i.venda_id,
      i.variacao_id,
      p.nome,
      vv.sku,
      i.quantidade,
      i.preco_tabela,
      i.preco_unitario
     from public.venda_itens i
     join public.vendas v on v.id = i.venda_id and v.operacao_id = i.operacao_id
     join public.minha_sessao_caixa m on m.sessao_id = v.sessao_id
     join public.catalogo_variacoes vv on vv.id = i.variacao_id and vv.operacao_id = i.operacao_id
     join public.catalogo_produtos p on p.id = vv.produto_id and p.operacao_id = vv.operacao_id
    where i.operacao_id = public.operacao_atual();

  alter table public.venda_itens drop constraint if exists venda_itens_variacao_ou_manual;
  alter table public.venda_itens drop column if exists descricao_manual;
  alter table public.venda_itens alter column variacao_id set not null;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='venda_itens' and column_name='descricao_manual')
     or exists (select 1 from information_schema.columns where table_schema='public' and table_name='venda_itens' and column_name='variacao_id' and is_nullable = 'YES') then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu venda_itens ao estado original.';
  end if;

  raise exception 'ENSAIO OK: item manual no PDV Varejo testado (T1 a T6) e desfeito identico ao inicial -- venda_itens.descricao_manual, registrar_venda/cancelar_venda/pdv_venda_itens no lugar. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
