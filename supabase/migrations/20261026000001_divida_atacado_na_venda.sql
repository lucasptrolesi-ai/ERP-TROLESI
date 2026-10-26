-- Dívida com o Atacado passa a nascer na VENDA, não no cadastro da peça -- pedido do usuário,
-- 2026-10-26: "o que eu cadastro de peça não pode ser o que eu devo pro atacado, apenas o que eu
-- vendo, o que é venda finalizada, seja pelo código da peça cadastrada, ou pelo que eu digito
-- manualmente". Hoje (20261009000001) "Veio do Atacado?" no cadastro já lança a dívida na hora,
-- mesmo que a peça nunca venda -- é exatamente isso que fica errado a partir desta migration.
--
-- `catalogo_variacoes` ganha `codigo_atacado numeric` (nullable) -- o código deixa de disparar
-- dívida na hora do cadastro e passa a ser só METADADO da peça ("essa peça, se vender, usa esse
-- código pra calcular quanto devo"). A calculadora de preço sugerido/piso/mínimo no cadastro
-- continua igual (não é isso que o usuário pediu pra mudar) -- só o LANÇAMENTO da dívida que sai de
-- lá.
--
-- `registrar_venda` ganha a lógica de lançar a dívida, pra cada item vendido:
--   - Peça de catálogo: lê `catalogo_variacoes.codigo_atacado` automaticamente (o vendedor nunca
--     digita isso no PDV pra peça já cadastrada -- já está salvo nela).
--   - Item manual: o PDV manda um `codigo_atacado` opcional dentro do próprio item (pedido explícito
--     do usuário: "na área do PDV que eu digito a peça e o valor deverá ter onde eu digito o código
--     da peça do atacado também"). Esse código NÃO entra no preço cobrado do cliente (preco_unitario
--     continua 100% livre, digitado à parte) -- só multiplica por 2,8 (mesmo fator de sempre,
--     `multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO')`) pra virar dívida.
--   - Sem código (nenhum dos dois casos) -> nenhuma dívida, como já era pra peça que não vem do
--     Atacado.
--
-- `varejo_dividas_atacado` ganha `venda_item_id` (nullable, aponta pra `venda_itens`) -- é o novo elo
-- entre a dívida e a VENDA que a causou (em vez de `movimento_estoque_id`, que só existia porque a
-- dívida nascia junto com uma entrada de estoque no cadastro). As duas colunas antigas
-- (`movimento_estoque_id`, `variacao_id`) viram NULLABLE -- as 164 linhas já existentes (lançadas
-- pelo fluxo antigo) continuam exatamente como estão, intocadas; só as linhas NOVAS, a partir de
-- agora, nascem com `venda_item_id` preenchido e `movimento_estoque_id` nulo (item manual também
-- nasce com `variacao_id` nulo, mesmo padrão de `venda_itens.descricao_manual`).
--
-- `registrar_compra_atacado_varejo` É REMOVIDA -- era a única chamadora desse RPC
-- (`cadastrarPecaCatalogo`), e deixá-la viva permitiria contornar a regra nova chamando-a direto
-- (ela lançava a dívida na hora, exatamente o que não pode mais acontecer).
--
-- NÃO MUDA (decisão de escopo, não pedida pelo usuário): `cancelar_venda` não reverte a dívida
-- automaticamente quando a venda é cancelada -- fica registrado como limitação conhecida em
-- DECISIONS.md, igual outras decisões de escopo desta sessão. Também não migra/recalcula as 164
-- linhas antigas pro novo formato -- ficam como histórico do fluxo anterior.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Devolve registrar_venda/editar_produto_catalogo/cadastrar_produto_catalogo e recria
-- -- registrar_compra_atacado_varejo. BLOQUEIA o desfazer se já existir alguma dívida lançada pelo
-- -- novo fluxo (venda_item_id preenchido) ou alguma peça com codigo_atacado -- nesse caso o jeito é
-- -- manter a feature.
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

  alter table public.catalogo_variacoes add column codigo_atacado numeric;
  alter table public.catalogo_variacoes add constraint catalogo_variacoes_codigo_atacado_check
    check (codigo_atacado is null or codigo_atacado > 0);

  alter table public.varejo_dividas_atacado alter column variacao_id drop not null;
  alter table public.varejo_dividas_atacado alter column movimento_estoque_id drop not null;
  alter table public.varejo_dividas_atacado add column venda_item_id uuid references public.venda_itens (id);
  alter table public.varejo_dividas_atacado add constraint varejo_dividas_atacado_origem_check
    check (movimento_estoque_id is not null or venda_item_id is not null);

  drop function if exists public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text);

  create or replace function public.cadastrar_produto_catalogo(p_nome text, p_categoria text, p_variacoes jsonb)
  returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    v_prod uuid;
    v_item jsonb;
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_variacoes is null or jsonb_typeof(p_variacoes) <> 'array' or jsonb_array_length(p_variacoes) = 0 then
      raise exception 'O produto precisa de ao menos uma variacao';
    end if;

    insert into public.catalogo_produtos (nome, categoria) values (trim(p_nome), nullif(trim(coalesce(p_categoria, '')), ''))
    returning id into v_prod;

    for v_item in select e from jsonb_array_elements(p_variacoes) e loop
      if nullif(v_item ->> 'preco_venda', '')::numeric is null or (v_item ->> 'preco_venda')::numeric < 0 then
        raise exception 'Informe o preco de venda de cada variacao';
      end if;
      insert into public.catalogo_variacoes (produto_id, sku, atributos, preco_venda, preco_minimo, foto_url, localizacao, codigo_atacado)
      values (v_prod, nullif(trim(coalesce(v_item ->> 'sku', '')), ''), coalesce(v_item -> 'atributos', '{}'::jsonb),
        public.arredondar_moeda((v_item ->> 'preco_venda')::numeric),
        case when nullif(v_item ->> 'preco_minimo', '') is not null then public.arredondar_moeda((v_item ->> 'preco_minimo')::numeric) else null end,
        nullif(v_item ->> 'foto_url', ''), coalesce(v_item -> 'localizacao', '{}'::jsonb),
        nullif(v_item ->> 'codigo_atacado', '')::numeric);
    end loop;

    return v_prod;
  end
  $$;

  drop function if exists public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb);

  create function public.editar_produto_catalogo(
    p_produto_id uuid, p_variacao_id uuid, p_nome text, p_categoria text, p_sku text, p_atributos jsonb,
    p_preco_venda numeric, p_preco_minimo numeric, p_foto_url text, p_ativo boolean,
    p_localizacao jsonb default '{}'::jsonb, p_codigo_atacado numeric default null::numeric
  ) returns void
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_preco_venda is null or p_preco_venda < 0 then
      raise exception 'Informe o preco de venda';
    end if;

    update public.catalogo_produtos
       set nome = trim(p_nome), categoria = nullif(trim(coalesce(p_categoria, '')), ''), atualizado_em = now()
     where id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Produto nao encontrado';
    end if;

    update public.catalogo_variacoes
       set sku = coalesce(v_sku, sku),
           atributos = coalesce(p_atributos, '{}'::jsonb),
           preco_venda = public.arredondar_moeda(p_preco_venda),
           preco_minimo = case when p_preco_minimo is not null then public.arredondar_moeda(p_preco_minimo) else null end,
           foto_url = p_foto_url,
           ativo = p_ativo,
           localizacao = coalesce(p_localizacao, '{}'::jsonb),
           codigo_atacado = p_codigo_atacado,
           atualizado_em = now()
     where id = p_variacao_id and produto_id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Variacao nao encontrada';
    end if;
  end
  $$;

  revoke execute on function public.editar_produto_catalogo(
    uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb, numeric
  ) from public, anon;
  grant execute on function public.editar_produto_catalogo(
    uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb, numeric
  ) to authenticated;

  create or replace function public.registrar_venda(
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
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='catalogo_variacoes' and column_name='codigo_atacado') then
    raise exception 'FALHA: catalogo_variacoes.codigo_atacado nao existe';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='varejo_dividas_atacado' and column_name='venda_item_id') then
    raise exception 'FALHA: varejo_dividas_atacado.venda_item_id nao existe';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='varejo_dividas_atacado' and column_name='variacao_id' and is_nullable='NO') then
    raise exception 'FALHA: varejo_dividas_atacado.variacao_id continua NOT NULL';
  end if;
  if to_regprocedure('public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text)') is not null then
    raise exception 'FALHA: registrar_compra_atacado_varejo ainda existe';
  end if;
  if to_regprocedure('public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb, numeric)') is null then
    raise exception 'FALHA: editar_produto_catalogo (com p_codigo_atacado) nao existe';
  end if;
  if to_regprocedure('public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb)') is not null then
    raise exception 'FALHA: assinatura antiga de editar_produto_catalogo ainda existe';
  end if;

  raise notice 'VERIFICACAO OK: codigo_atacado, venda_item_id, registrar_venda/cadastrar_produto_catalogo/editar_produto_catalogo atualizados, registrar_compra_atacado_varejo removida.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod1 uuid;
  v_var1 uuid;
  v_prod2 uuid;
  v_var2 uuid;
  v_venda1 uuid;
  v_venda2 uuid;
  v_venda3 uuid;
  v_divida record;
  v_n int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. Cadastrar peca com codigo_atacado=10 -> salva so como metadado, ZERO divida criada.
  v_prod1 := public.cadastrar_produto_catalogo('ZZ ENSAIO DIVIDA ATACADO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZDIV1', 'atributos', '{}'::jsonb, 'preco_venda', 100.00, 'codigo_atacado', 10)));
  select id into v_var1 from public.catalogo_variacoes where produto_id = v_prod1;
  select count(*) into v_n from public.varejo_dividas_atacado where variacao_id = v_var1;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T1]: cadastro de peca gerou divida (deveria ser zero)'; end if;

  -- Peca SEM codigo_atacado, pra T3.
  v_prod2 := public.cadastrar_produto_catalogo('ZZ ENSAIO SEM ATACADO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZDIV2', 'atributos', '{}'::jsonb, 'preco_venda', 50.00)));
  select id into v_var2 from public.catalogo_variacoes where produto_id = v_prod2;

  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var1, 10, 20.00, 'ensaio divida atacado');
  perform public.registrar_entrada_estoque(v_dep, v_var2, 10, 15.00, 'ensaio divida atacado');

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- T2. Vender a peca com codigo_atacado (qtd 2) -> divida criada: 10 * 2,8 = 28 por unidade, 56 total.
  v_venda1 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var1, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 200.00)),
    gen_random_uuid()
  );
  select * into v_divida from public.varejo_dividas_atacado where variacao_id = v_var1;
  if v_divida.custo_unitario <> 28.00 then raise exception 'TESTE FALHOU [T2]: custo_unitario errado (%), esperava 28.00', v_divida.custo_unitario; end if;
  if v_divida.custo_total <> 56.00 then raise exception 'TESTE FALHOU [T2]: custo_total errado (%), esperava 56.00', v_divida.custo_total; end if;
  if v_divida.status <> 'em_aberto' then raise exception 'TESTE FALHOU [T2]: status deveria nascer em_aberto'; end if;
  if v_divida.movimento_estoque_id is not null then raise exception 'TESTE FALHOU [T2]: divida de venda nao deveria ter movimento_estoque_id'; end if;
  if not exists (select 1 from public.venda_itens where id = v_divida.venda_item_id and venda_id = v_venda1) then
    raise exception 'TESTE FALHOU [T2]: venda_item_id nao aponta pro item da venda1';
  end if;

  -- T3. Vender peca SEM codigo_atacado -> nenhuma divida.
  v_venda2 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var2, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 50.00)),
    gen_random_uuid()
  );
  select count(*) into v_n from public.varejo_dividas_atacado where variacao_id = v_var2;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T3]: peca sem codigo_atacado gerou divida'; end if;

  -- T4. Item manual com codigo_atacado=15 (qtd 1, preco_unitario=100 livre) -> divida 15*2,8=42,
  -- preco de venda NAO afetado.
  v_venda3 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('descricao_manual', 'ZZ Corrente ensaio', 'quantidade', 1, 'preco_unitario', 100.00, 'codigo_atacado', 15)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
    gen_random_uuid()
  );
  select * into v_divida from public.varejo_dividas_atacado d join public.venda_itens i on i.id = d.venda_item_id where i.venda_id = v_venda3;
  if v_divida.variacao_id is not null then raise exception 'TESTE FALHOU [T4]: divida de item manual nao deveria ter variacao_id'; end if;
  if v_divida.custo_unitario <> 42.00 then raise exception 'TESTE FALHOU [T4]: custo_unitario errado (%), esperava 42.00', v_divida.custo_unitario; end if;
  if (select preco_unitario from public.venda_itens where id = v_divida.venda_item_id) <> 100.00 then
    raise exception 'TESTE FALHOU [T4]: codigo_atacado alterou o preco de venda do item manual';
  end if;

  -- T5. Item manual SEM codigo_atacado -> nenhuma divida.
  declare
    v_venda4 uuid;
    v_item4 uuid;
  begin
    v_venda4 := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('descricao_manual', 'ZZ Sem atacado', 'quantidade', 1, 'preco_unitario', 30.00)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 30.00)),
      gen_random_uuid()
    );
    select id into v_item4 from public.venda_itens where venda_id = v_venda4;
    select count(*) into v_n from public.varejo_dividas_atacado where venda_item_id = v_item4;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T5]: item manual sem codigo_atacado gerou divida'; end if;
  end;

  -- T6. Item manual com codigo_atacado <= 0 -> bloqueado.
  begin
    perform public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('descricao_manual', 'ZZ Codigo invalido', 'quantidade', 1, 'preco_unitario', 30.00, 'codigo_atacado', 0)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 30.00)),
      gen_random_uuid()
    );
    raise exception 'TESTE FALHOU [T6]: codigo_atacado zero deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'Codigo do Atacado deve ser maior que zero' then raise; end if;
  end;

  -- T7. editar_produto_catalogo seta e depois limpa codigo_atacado.
  perform public.editar_produto_catalogo(v_prod2, v_var2, 'ZZ ENSAIO SEM ATACADO', 'ANEL', 'ZZDIV2', '{}'::jsonb, 50.00, null, null, true, '{}'::jsonb, 20.00);
  if (select codigo_atacado from public.catalogo_variacoes where id = v_var2) <> 20.00 then
    raise exception 'TESTE FALHOU [T7a]: editar_produto_catalogo nao setou codigo_atacado';
  end if;
  perform public.editar_produto_catalogo(v_prod2, v_var2, 'ZZ ENSAIO SEM ATACADO', 'ANEL', 'ZZDIV2', '{}'::jsonb, 50.00, null, null, true, '{}'::jsonb, null);
  if (select codigo_atacado from public.catalogo_variacoes where id = v_var2) is not null then
    raise exception 'TESTE FALHOU [T7b]: editar_produto_catalogo nao limpou codigo_atacado';
  end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T7 (cadastro nunca gera divida, venda de peca com codigo gera, sem codigo nao gera, item manual com/sem codigo, codigo invalido bloqueia, editar seta/limpa).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  if exists (select 1 from public.varejo_dividas_atacado where venda_item_id is not null) then
    raise exception 'DESFAZER BLOQUEADO: ja existe divida lancada pelo novo fluxo (venda_item_id preenchido) -- desfazer perderia esse dado. Mantenha a feature em vez de reverter.';
  end if;
  if exists (select 1 from public.catalogo_variacoes where codigo_atacado is not null) then
    raise exception 'DESFAZER BLOQUEADO: ja existe peca com codigo_atacado preenchido -- desfazer perderia esse dado. Mantenha a feature em vez de reverter.';
  end if;

  create or replace function public.registrar_venda(
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
  $$;

  drop function if exists public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb, numeric);

  create function public.editar_produto_catalogo(
    p_produto_id uuid, p_variacao_id uuid, p_nome text, p_categoria text, p_sku text, p_atributos jsonb,
    p_preco_venda numeric, p_preco_minimo numeric, p_foto_url text, p_ativo boolean, p_localizacao jsonb default '{}'::jsonb
  ) returns void
  language plpgsql security definer set search_path = public as $$
  declare
    v_op uuid := public.operacao_atual();
    v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_preco_venda is null or p_preco_venda < 0 then
      raise exception 'Informe o preco de venda';
    end if;

    update public.catalogo_produtos
       set nome = trim(p_nome), categoria = nullif(trim(coalesce(p_categoria, '')), ''), atualizado_em = now()
     where id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Produto nao encontrado';
    end if;

    update public.catalogo_variacoes
       set sku = coalesce(v_sku, sku),
           atributos = coalesce(p_atributos, '{}'::jsonb),
           preco_venda = public.arredondar_moeda(p_preco_venda),
           preco_minimo = case when p_preco_minimo is not null then public.arredondar_moeda(p_preco_minimo) else null end,
           foto_url = p_foto_url,
           ativo = p_ativo,
           localizacao = coalesce(p_localizacao, '{}'::jsonb),
           atualizado_em = now()
     where id = p_variacao_id and produto_id = p_produto_id and operacao_id = v_op;
    if not found then
      raise exception 'Variacao nao encontrada';
    end if;
  end
  $$;

  revoke execute on function public.editar_produto_catalogo(
    uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb
  ) from public, anon;
  grant execute on function public.editar_produto_catalogo(
    uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb
  ) to authenticated;

  create or replace function public.cadastrar_produto_catalogo(p_nome text, p_categoria text, p_variacoes jsonb)
  returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    v_prod uuid;
    v_item jsonb;
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_nome is null or length(trim(p_nome)) = 0 then
      raise exception 'Informe o nome do produto';
    end if;
    if p_variacoes is null or jsonb_typeof(p_variacoes) <> 'array' or jsonb_array_length(p_variacoes) = 0 then
      raise exception 'O produto precisa de ao menos uma variacao';
    end if;

    insert into public.catalogo_produtos (nome, categoria) values (trim(p_nome), nullif(trim(coalesce(p_categoria, '')), ''))
    returning id into v_prod;

    for v_item in select e from jsonb_array_elements(p_variacoes) e loop
      if nullif(v_item ->> 'preco_venda', '')::numeric is null or (v_item ->> 'preco_venda')::numeric < 0 then
        raise exception 'Informe o preco de venda de cada variacao';
      end if;
      insert into public.catalogo_variacoes (produto_id, sku, atributos, preco_venda, preco_minimo, foto_url, localizacao)
      values (v_prod, nullif(trim(coalesce(v_item ->> 'sku', '')), ''), coalesce(v_item -> 'atributos', '{}'::jsonb),
        public.arredondar_moeda((v_item ->> 'preco_venda')::numeric),
        case when nullif(v_item ->> 'preco_minimo', '') is not null then public.arredondar_moeda((v_item ->> 'preco_minimo')::numeric) else null end,
        nullif(v_item ->> 'foto_url', ''), coalesce(v_item -> 'localizacao', '{}'::jsonb));
    end loop;

    return v_prod;
  end
  $$;

  create function public.registrar_compra_atacado_varejo(p_variacao_id uuid, p_deposito_id uuid, p_codigo_atacado numeric, p_quantidade integer, p_status text default 'em_aberto'::text, p_observacao text default null::text)
  returns uuid
  language plpgsql security definer set search_path = public as $$
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

    v_fator := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
    v_custo_unitario := public.arredondar_moeda(p_codigo_atacado * v_fator);
    v_custo_total := public.arredondar_moeda(v_custo_unitario * p_quantidade);

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
  $$;

  revoke execute on function public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text) from public, anon;
  grant execute on function public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text) to authenticated;

  alter table public.varejo_dividas_atacado drop constraint if exists varejo_dividas_atacado_origem_check;
  alter table public.varejo_dividas_atacado drop column if exists venda_item_id;
  alter table public.varejo_dividas_atacado alter column movimento_estoque_id set not null;
  alter table public.varejo_dividas_atacado alter column variacao_id set not null;

  alter table public.catalogo_variacoes drop constraint if exists catalogo_variacoes_codigo_atacado_check;
  alter table public.catalogo_variacoes drop column if exists codigo_atacado;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='catalogo_variacoes' and column_name='codigo_atacado')
     or exists (select 1 from information_schema.columns where table_schema='public' and table_name='varejo_dividas_atacado' and column_name='venda_item_id')
     or to_regprocedure('public.registrar_compra_atacado_varejo(uuid, uuid, numeric, integer, text, text)') is null
     or to_regprocedure('public.editar_produto_catalogo(uuid, uuid, text, text, text, jsonb, numeric, numeric, text, boolean, jsonb, numeric)') is not null then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: divida com o Atacado passa a nascer na venda (T1 a T7), testado e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
