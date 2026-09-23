-- Etapa 5a do modulo de varejo: PDV de vendas.
-- Pre-requisito: etapas 1 a 4 aplicadas.
--
-- O QUE FAZ (uma transacao so):
--   1. vendas / venda_itens / venda_pagamentos (numeric(12,2), por operacao, numeracao propria por
--      operacao em contadores_operacao). Ninguem grava direto: so registrar_venda e cancelar_venda.
--   2. registrar_venda(): o servidor le o PRECO no catalogo (o cliente so pode pedir um preco MENOR),
--      recalcula todos os totais, confere estoque, grava o movimento de estoque com o custo medio do
--      momento e COPIA esse mesmo custo para venda_itens.custo_unitario (custo congelado no fato).
--      Preco abaixo do minimo (ou de tabela, se nao houver minimo) exige autorizacao de supervisor
--      (PIN, pontual, uso unico). Pagamento em dinheiro gera movimento de caixa liquido de troco.
--      Idempotente por chave. Auditoria do desconto abaixo do piso.
--   3. cancelar_venda(): exige autorizacao de supervisor, devolve o estoque pelo CUSTO ORIGINAL da
--      venda (nao recalcula), estorna o dinheiro no caixa, registra quem autorizou e audita.
--   4. Views do PDV sem custo (pdv_vendas, pdv_venda_itens, pdv_venda_pagamentos) restritas a sessao
--      aberta do proprio operador. A tabela venda_itens (com custo) so o admin le.
--
-- COMO RODAR: igual as etapas anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo tem o DROP/DELETE
-- -- exato para cada CREATE/INSERT deste arquivo, gerado a partir da mesma lista usada por
-- -- 'aplicar', e testado pelo proprio modo 'ensaio' antes de chegar aqui):
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

create temp table _op5_pendencias (chave text primary key, descricao text not null) on commit drop;

insert into _op5_pendencias (chave, descricao) values
  ('varejo_fiscal_nfce',
   'A venda do varejo ainda nao emite documento fiscal (NFC-e). A serie do VAREJO segue pendente (serie_fiscal_varejo). Cliente e opcional na venda.'),
  ('varejo_taxas_maquininha',
   'Taxas de cartao e prazo de recebimento nao sao modelados; venda_pagamentos guarda so forma, valor e parcelas. Contas a receber do varejo (cartao/pix) ainda nao existem.'),
  ('cancelamento_sessao_fechada',
   'cancelar_venda so funciona com a sessao de caixa ainda aberta e pelo proprio operador. Cancelamento de venda de sessao fechada exige ajuste manual com admin e ainda nao tem fluxo.'),
  ('desconto_piso_sem_minimo',
   'Sem preco_minimo cadastrado, o piso e o proprio preco de tabela (qualquer desconto exige PIN). Definir preco_minimo por variacao.');

create temp table _fp_antes on commit drop as
  select 'T ' || c.relname || ' ' || c.relkind::text as item
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
  union all
  select 'C ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'I ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'P ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'G ' || tgrelid::regclass::text || ' ' || tgname
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'D pending_decisions ' || count(*) || ' ' || count(*) filter (where ativo) from public.pending_decisions;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.consumir_autorizacao(uuid, text, uuid)') is null then
    raise exception 'ABORTADO: etapa 4 nao aplicada (consumir_autorizacao ausente).';
  end if;
  if to_regclass('public.vendas') is not null then
    raise exception 'ABORTADO: etapa 5a parece ja aplicada (vendas existe).';
  end if;

  -- 1. Numeracao por operacao -------------------------------------------------------------------------
  create table public.contadores_operacao (
    operacao_id uuid not null references public.operacoes (id),
    nome text not null,
    ultimo bigint not null default 0,
    primary key (operacao_id, nome)
  );
  alter table public.contadores_operacao enable row level security;
  revoke all on public.contadores_operacao from anon, authenticated;

  create or replace function public.proximo_numero_operacao(p_nome text) returns bigint
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_n bigint;
  begin
    if v_op is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    insert into public.contadores_operacao (operacao_id, nome, ultimo) values (v_op, p_nome, 1)
    on conflict (operacao_id, nome) do update set ultimo = public.contadores_operacao.ultimo + 1
    returning ultimo into v_n;
    return v_n;
  end
  $fn$;
  revoke execute on function public.proximo_numero_operacao(text) from public, anon, authenticated;

  -- 2. Vendas -------------------------------------------------------------------------------------------
  create table public.vendas (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    numero bigint not null,
    sessao_id uuid not null,
    deposito_id uuid not null,
    operador_id uuid not null references public.profiles (id),
    status text not null default 'concluida' check (status in ('concluida', 'cancelada')),
    subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
    desconto_total numeric(12, 2) not null default 0 check (desconto_total >= 0),
    total numeric(12, 2) not null default 0 check (total >= 0),
    troco numeric(12, 2) not null default 0 check (troco >= 0),
    cliente_nome text,
    cliente_documento text,
    idempotency_key uuid,
    desconto_autorizado_por uuid references public.profiles (id),
    criada_em timestamptz not null default now(),
    cancelada_em timestamptz,
    cancelada_por uuid references public.profiles (id),
    cancelamento_autorizado_por uuid references public.profiles (id),
    motivo_cancelamento text,
    constraint vendas_id_operacao_key unique (id, operacao_id),
    constraint vendas_operacao_numero_key unique (operacao_id, numero),
    constraint vendas_sessao_op_fkey foreign key (sessao_id, operacao_id) references public.caixa_sessoes (id, operacao_id),
    constraint vendas_deposito_op_fkey foreign key (deposito_id, operacao_id) references public.depositos (id, operacao_id),
    constraint vendas_cancelamento check ((status = 'concluida' and cancelada_em is null)
      or (status = 'cancelada' and cancelada_em is not null and cancelamento_autorizado_por is not null and motivo_cancelamento is not null))
  );
  create unique index vendas_operacao_idempotencia_key on public.vendas (operacao_id, idempotency_key) where idempotency_key is not null;
  create index vendas_operacao_id_idx on public.vendas (operacao_id);
  create index vendas_sessao_idx on public.vendas (sessao_id);

  create table public.venda_itens (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    venda_id uuid not null,
    variacao_id uuid not null,
    quantidade integer not null check (quantidade > 0),
    preco_tabela numeric(12, 2) not null check (preco_tabela >= 0),
    preco_unitario numeric(12, 2) not null check (preco_unitario >= 0),
    custo_unitario numeric(12, 2) not null check (custo_unitario >= 0),
    constraint venda_itens_venda_op_fkey foreign key (venda_id, operacao_id) references public.vendas (id, operacao_id),
    constraint venda_itens_variacao_op_fkey foreign key (variacao_id, operacao_id) references public.catalogo_variacoes (id, operacao_id)
  );
  create index venda_itens_operacao_id_idx on public.venda_itens (operacao_id);
  create index venda_itens_venda_idx on public.venda_itens (venda_id);

  create table public.venda_pagamentos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    venda_id uuid not null,
    forma text not null check (forma in ('dinheiro', 'pix', 'debito', 'credito')),
    valor numeric(12, 2) not null check (valor > 0),
    parcelas integer not null default 1 check (parcelas between 1 and 12),
    constraint venda_pagamentos_venda_op_fkey foreign key (venda_id, operacao_id) references public.vendas (id, operacao_id)
  );
  create index venda_pagamentos_operacao_id_idx on public.venda_pagamentos (operacao_id);
  create index venda_pagamentos_venda_idx on public.venda_pagamentos (venda_id);

  create trigger trg_carimbar_operacao before insert on public.vendas for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.vendas for each row execute function public.travar_operacao();
  create trigger trg_carimbar_operacao before insert on public.venda_itens for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.venda_itens for each row execute function public.travar_operacao();
  create trigger trg_carimbar_operacao before insert on public.venda_pagamentos for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.venda_pagamentos for each row execute function public.travar_operacao();

  create trigger trg_venda_itens_append_only before update or delete on public.venda_itens
    for each row execute function public.bloquear_alteracao_registro();
  create trigger trg_venda_pagamentos_append_only before update or delete on public.venda_pagamentos
    for each row execute function public.bloquear_alteracao_registro();

  alter table public.vendas enable row level security;
  alter table public.venda_itens enable row level security;
  alter table public.venda_pagamentos enable row level security;

  create policy "escopo de operacao" on public.vendas as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.venda_itens as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.venda_pagamentos as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));

  create policy "admin le vendas" on public.vendas for select to authenticated using (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin le venda_itens" on public.venda_itens for select to authenticated using (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin le venda_pagamentos" on public.venda_pagamentos for select to authenticated using (public.meu_papel() = 'admin'::public.papel_usuario);

  revoke all on public.vendas, public.venda_itens, public.venda_pagamentos from anon, authenticated;
  grant select on public.vendas, public.venda_itens, public.venda_pagamentos to authenticated;

  create view public.pdv_vendas as
    select v.id, v.numero, v.status, v.subtotal, v.desconto_total, v.total, v.troco, v.criada_em
      from public.vendas v join public.minha_sessao_caixa m on m.sessao_id = v.sessao_id
     where v.operacao_id = (select public.operacao_atual());

  create view public.pdv_venda_itens as
    select i.id, i.venda_id, i.variacao_id, p.nome, vv.sku, i.quantidade, i.preco_tabela, i.preco_unitario
      from public.venda_itens i
      join public.vendas v on v.id = i.venda_id and v.operacao_id = i.operacao_id
      join public.minha_sessao_caixa m on m.sessao_id = v.sessao_id
      join public.catalogo_variacoes vv on vv.id = i.variacao_id and vv.operacao_id = i.operacao_id
      join public.catalogo_produtos p on p.id = vv.produto_id and p.operacao_id = vv.operacao_id
     where i.operacao_id = (select public.operacao_atual());

  create view public.pdv_venda_pagamentos as
    select g.id, g.venda_id, g.forma, g.valor, g.parcelas
      from public.venda_pagamentos g
      join public.vendas v on v.id = g.venda_id and v.operacao_id = g.operacao_id
      join public.minha_sessao_caixa m on m.sessao_id = v.sessao_id
     where g.operacao_id = (select public.operacao_atual());

  revoke all on public.pdv_vendas, public.pdv_venda_itens, public.pdv_venda_pagamentos from anon, authenticated;
  grant select on public.pdv_vendas, public.pdv_venda_itens, public.pdv_venda_pagamentos to authenticated;

  -- 3. registrar_venda --------------------------------------------------------------------------------------
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
        raise exception 'Estoque insuficiente (saldo %, pedido %)', v_saldo, v_qtd;
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

  -- 4. cancelar_venda ---------------------------------------------------------------------------------------
  create or replace function public.cancelar_venda(p_venda_id uuid, p_motivo text, p_autorizacao_id uuid) returns void
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

  revoke execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid),
    public.cancelar_venda(uuid, text, uuid) from public, anon, authenticated;
  grant execute on function public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid),
    public.cancelar_venda(uuid, text, uuid) to authenticated;

  insert into public.pending_decisions (chave, descricao, ativo)
  select chave, descricao, false from _op5_pendencias;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
  v_m bigint;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select count(*) into v_n from pg_policies where schemaname = 'public' and policyname = 'escopo de operacao' and permissive = 'RESTRICTIVE'
     and tablename in ('vendas', 'venda_itens', 'venda_pagamentos');
  if v_n <> 3 then raise exception 'FALHA: politicas restritivas novas = %, esperado 3', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name in ('pdv_vendas', 'pdv_venda_itens', 'pdv_venda_pagamentos') and column_name ilike '%custo%';
  if v_n <> 0 then raise exception 'FALHA: as views do PDV expoem % colunas de custo', v_n; end if;

  select count(*) into v_n from public.pending_decisions where chave in (select chave from _op5_pendencias);
  select count(*) into v_m from _op5_pendencias;
  if v_n <> v_m then raise exception 'FALHA: pendencias = %, esperado %', v_n, v_m; end if;

  raise notice 'VERIFICACAO OK: vendas, itens, pagamentos, views sem custo, funcoes.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_caixa uuid;
  v_dep uuid;
  v_prod uuid;
  v_va uuid;
  v_vb uuid;
  v_sessao uuid;
  v_v1 uuid;
  v_v2 uuid;
  v_key uuid := gen_random_uuid();
  v_aut uuid;
  v_json jsonb;
  v_n bigint;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id, deposito_id into v_caixa, v_dep from public.caixas where operacao_id = v_varejo and nome = 'CAIXA 1';

  update public.operacoes set ativo = true where id = v_varejo;
  delete from public.usuario_operacoes where profile_id = v_barbara and operacao_id = v_atacado;
  insert into public.usuario_operacoes (profile_id, operacao_id, padrao) values (v_barbara, v_varejo, true);

  -- Preparo (Lucas, admin, contexto VAREJO): catalogo com 2 variacoes, estoque com custo, PIN de supervisor
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  insert into public.catalogo_produtos (nome, categoria) values ('ZZ ENSAIO PDV', 'ANEL') returning id into v_prod;
  insert into public.catalogo_variacoes (produto_id, sku, preco_venda, preco_minimo) values (v_prod, 'ZZPDV-A', 100.00, 90.00) returning id into v_va;
  insert into public.catalogo_variacoes (produto_id, sku, preco_venda, preco_minimo) values (v_prod, 'ZZPDV-B', 50.00, 45.00) returning id into v_vb;
  execute 'set constraints all immediate';
  perform public.registrar_entrada_estoque(v_dep, v_va, 10, 40.00, 'ensaio');
  perform public.registrar_entrada_estoque(v_dep, v_vb, 5, 20.00, 'ensaio');
  perform public.definir_pin_supervisor(v_lucas, '1234');
  execute 'reset role';

  -- Barbara abre o caixa com fundo de 100
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_sessao := public.abrir_sessao_caixa(v_caixa, 100);

  -- T1. Venda 1: 2x A (100) + 1x B (50) = 250; paga 300 em dinheiro => troco 50
  v_v1 := public.registrar_venda(v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 2), jsonb_build_object('variacao_id', v_vb, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 300)), v_key);
  execute 'reset role';
  select count(*) into v_n from public.vendas where id = v_v1 and total = 250 and subtotal = 250 and desconto_total = 0 and troco = 50 and numero = 1;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: totais/numero da venda 1 incorretos'; end if;
  select count(*) into v_n from public.caixa_movimentos where documento_id = v_v1 and tipo = 'venda_dinheiro' and valor = 250;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: movimento de caixa da venda deveria ser 250 (300 recebidos - 50 de troco)'; end if;

  -- T2. Custo congelado: a linha da venda e o movimento de estoque guardam o mesmo custo (40 e 20)
  select count(*) into v_n from public.venda_itens i
    join public.estoque_movimentos m on m.documento_id = i.venda_id and m.variacao_id = i.variacao_id and m.tipo = 'venda'
   where i.venda_id = v_v1 and i.custo_unitario = m.custo_unitario
     and ((i.variacao_id = v_va and i.custo_unitario = 40.00) or (i.variacao_id = v_vb and i.custo_unitario = 20.00));
  if v_n <> 2 then raise exception 'TESTE FALHOU [T2]: custo da venda_itens nao e copia do movimento (linhas conferidas: %)', v_n; end if;

  -- T3. Idempotencia: repetir a mesma chave devolve a mesma venda e nao baixa estoque de novo
  execute 'set local role authenticated';
  if public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 2)),
       jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 999)), v_key) <> v_v1 then
    raise exception 'TESTE FALHOU [T3]: idempotencia devolveu outra venda';
  end if;
  select saldo into v_n from public.estoque_saldos where variacao_id = v_va;
  if v_n is distinct from 8 then raise exception 'TESTE FALHOU [T3]: saldo de A = %, esperado 8', v_n; end if;

  -- T4. Regras da venda: estoque insuficiente, pagamento insuficiente, preco acima da tabela
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_vb, 'quantidade', 99)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 99999)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: estoque insuficiente foi aceito'; end if;
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 10)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: pagamento insuficiente foi aceito'; end if;
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 1, 'preco_unitario', 500)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 500)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: preco acima da tabela foi aceito (o cliente nao manda no preco)'; end if;

  -- T5. Desconto abaixo do minimo exige PIN; com autorizacao passa e ela e consumida
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 1, 'preco_unitario', 85)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 85)));
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: desconto abaixo do minimo passou sem autorizacao'; end if;
  v_json := public.autorizar_acao(v_lucas, '1234', 'desconto_abaixo_piso', v_sessao);
  v_aut := (v_json ->> 'autorizacao_id')::uuid;
  v_v2 := public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 1, 'preco_unitario', 85)),
    jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 85)), null, 'CLIENTE ENSAIO', null, v_aut);
  v_ok := false;
  begin
    perform public.registrar_venda(v_sessao, jsonb_build_array(jsonb_build_object('variacao_id', v_va, 'quantidade', 1, 'preco_unitario', 85)),
      jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 85)), null, null, null, v_aut);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T5]: a mesma autorizacao liberou um segundo desconto'; end if;
  execute 'reset role';
  select count(*) into v_n from public.vendas where id = v_v2 and total = 85 and subtotal = 100 and desconto_total = 15 and desconto_autorizado_por = v_lucas;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T5]: venda com desconto nao registrou total/desconto/supervisor'; end if;
  select count(*) into v_n from public.audit_log where acao = 'desconto_abaixo_piso' and registro_id = v_v2 and usuario_id = v_barbara;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T5]: desconto abaixo do piso nao foi auditado'; end if;

  -- T6. Vendedora nao le custo: tabelas negadas; views do PDV mostram itens sem custo
  execute 'set local role authenticated';
  -- venda_itens tem GRANT SELECT para authenticated (o admin precisa ler o custo); quem protege
  -- e a RLS (so a policy "admin le venda_itens" e permissiva pra leitura direta), entao a
  -- vendedora consegue rodar a consulta mas nao ve nenhuma linha (nao gera excecao).
  select count(*) into v_n from public.venda_itens;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T6]: vendedora leu % linha(s) de venda_itens (tem custo)', v_n; end if;
  select count(*) into v_n from public.pdv_venda_itens where venda_id = v_v1;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T6]: pdv_venda_itens = %, esperado 2', v_n; end if;
  select count(*) into v_n from public.pdv_vendas;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T6]: pdv_vendas = %, esperado 2', v_n; end if;
  execute 'reset role';

  -- T7. Cancelamento: exige autorizacao; devolve pelo custo ORIGINAL mesmo com custo medio alterado depois
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  perform public.registrar_entrada_estoque(v_dep, v_va, 10, 100.00, 'custo novo, muda o medio');
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.cancelar_venda(v_v1, 'cliente desistiu', gen_random_uuid());
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: cancelamento sem autorizacao valida foi aceito'; end if;
  v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_v1);
  perform public.cancelar_venda(v_v1, 'cliente desistiu', (v_json ->> 'autorizacao_id')::uuid);
  execute 'reset role';
  select count(*) into v_n from public.estoque_movimentos
   where documento_id = v_v1 and tipo = 'devolucao_venda' and variacao_id = v_va and quantidade = 2 and custo_unitario = 40.00;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T7]: devolucao nao usou o custo original congelado (40.00)'; end if;
  select count(*) into v_n from public.vendas where id = v_v1 and status = 'cancelada' and cancelamento_autorizado_por = v_lucas and cancelada_por = v_barbara;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T7]: cancelamento nao registrou quem cancelou e quem autorizou'; end if;
  select count(*) into v_n from public.caixa_movimentos where documento_id = v_v1 and tipo = 'estorno_dinheiro' and valor = 250 and autorizado_por = v_lucas;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T7]: estorno de dinheiro no caixa incorreto'; end if;
  select count(*) into v_n from public.audit_log where acao = 'cancelamento_venda' and registro_id = v_v1;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T7]: cancelamento nao foi auditado'; end if;

  -- T8. Cancelar duas vezes nao pode
  execute 'set local role authenticated';
  v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_v1);
  v_ok := false;
  begin
    perform public.cancelar_venda(v_v1, 'de novo', (v_json ->> 'autorizacao_id')::uuid);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T8]: venda cancelada duas vezes'; end if;

  -- T9. Fechamento: fundo 100 + venda 250 - estorno 250 = 100 esperado (venda 2 foi pix); informa 100
  v_json := public.fechar_sessao_caixa(v_sessao, 100);
  if (v_json ->> 'valor_esperado')::numeric <> 100 or (v_json ->> 'divergencia')::numeric <> 0 then
    raise exception 'TESTE FALHOU [T9]: fechamento devolveu %', v_json;
  end if;
  execute 'reset role';

  -- T10. Isolamento: contexto ATACADO nao ve vendas do varejo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.vendas;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T10]: contexto ATACADO viu % vendas do varejo', v_n; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T10 (venda, custo congelado, idempotencia, PIN de desconto, cancelamento, fechamento, isolamento).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop view if exists public.pdv_venda_pagamentos;
  drop view if exists public.pdv_venda_itens;
  drop view if exists public.pdv_vendas;
  drop table if exists public.venda_pagamentos, public.venda_itens, public.vendas, public.contadores_operacao;

  drop function if exists public.cancelar_venda(uuid, text, uuid);
  drop function if exists public.registrar_venda(uuid, jsonb, jsonb, uuid, text, text, uuid);
  drop function if exists public.proximo_numero_operacao(text);

  delete from public.pending_decisions where chave in (select chave from _op5_pendencias);
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
    select 'C ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
      from information_schema.columns where table_schema = 'public'
    union all
    select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      from pg_constraint where connamespace = 'public'::regnamespace
    union all
    select 'I ' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select 'P ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
      from pg_policies where schemaname in ('public', 'storage')
    union all
    select 'G ' || tgrelid::regclass::text || ' ' || tgname
      from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
      from pg_proc p where p.pronamespace = 'public'::regnamespace
    union all
    select 'D pending_decisions ' || count(*) || ' ' || count(*) filter (where ativo) from public.pending_decisions;

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: etapa 5a aplicada, verificada, testada (T1 a T10) e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
