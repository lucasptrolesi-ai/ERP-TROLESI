-- Cupom de desconto do Varejo ganha validade obrigatoria e limite de 1 uso por cliente (pedido do
-- usuario, 2026-10-22) -- hoje (Fase 2, 20261020000001) o cupom nunca vence e pode ser usado sem
-- limite por qualquer um, igual o PDV Eventos. A partir desta migration, cada cupom tem uma data de
-- validade obrigatoria, e cada CLIENTE (identificado pelo cadastro, exigindo CPF/CNPJ preenchido) so
-- pode usar um dado cupom UMA vez -- nunca mais, mesmo em vendas diferentes.
--
-- "Por CPF" na pratica vira "por cliente_id": usar um cupom passa a EXIGIR cliente selecionado no
-- PDV (sem isso nao haveria ninguem pra checar o limite contra) -- decisao direta do usuario, nao
-- suposta. E o cliente selecionado precisa ter CPF/CNPJ cadastrado -- sem isso, "por CPF" nao tem
-- como valer de verdade pra aquele cadastro.
--
-- Nova tabela `cupons_varejo_usos` -- um historico append-only (sem update nem delete, mesma
-- filosofia de cashback_lancamentos) com UNIQUE (cupom_id, cliente_id): essa constraint SOZINHA ja
-- garante "nunca duas vezes pro mesmo cliente", independente do caminho de insercao (funcao ou
-- direto) -- diferente do cashback, nao precisou de uma trigger de validacao separada, porque aqui
-- nao ha estado pra "transicionar" (cada linha e so um fato: "este cliente usou este cupom nesta
-- venda", que nunca muda depois de gravado).
--
-- registrar_venda_varejo_com_cashback ganha um 14o parametro, p_cupom_id -- precisa de DROP (muda a
-- assinatura). NAO virou "registrar_venda_varejo_completa" nem nada do tipo: e a mesma function que
-- ja e o ponto de composicao atomica pra tudo que precisa acontecer JUNTO com a venda sem reabrir
-- registrar_venda -- cupom entra no mesmo lugar que cashback ja estava, so com um nome que hoje fica
-- um pouco estreito pro que faz (registrado aqui pra quem vier depois nao estranhar).
--
-- NAO mexe em calcularDescontoCupomVarejo nem no calculo do desconto em si (isso continua igual,
-- client-side) -- so adiciona a CHECAGEM de elegibilidade (vencido? ja usado? cliente tem CPF?) e o
-- REGISTRO do uso, atomico com a venda (se a checagem falhar, a venda inteira tambem nao e criada --
-- mesmo padrao do cashback).
--
-- Zero cupons cadastrados ate agora (confirmado antes de escrever esta migration) -- nao precisa de
-- backfill de validade pra nenhum cupom existente.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo. Apaga cupons_varejo_usos (perde o historico de uso), remove a coluna validade de
-- -- cupons_varejo, e devolve registrar_venda_varejo_com_cashback pra assinatura de 13 parametros
-- -- (sem cupom).
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

  alter table public.cupons_varejo add column validade date not null;

  create table public.cupons_varejo_usos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    cupom_id uuid not null references public.cupons_varejo (id),
    cliente_id uuid not null references public.clientes (id),
    venda_id uuid not null references public.vendas (id),
    usado_em timestamptz not null default now(),
    constraint cupons_varejo_usos_cupom_cliente_key unique (cupom_id, cliente_id)
  );
  create index cupons_varejo_usos_operacao_id_idx on public.cupons_varejo_usos (operacao_id);

  alter table public.cupons_varejo_usos enable row level security;
  -- SEM update nem delete de proposito -- cada linha e um fato que nunca muda (mesma filosofia de
  -- cashback_lancamentos: historico, nao estado mutavel).
  grant select, insert on public.cupons_varejo_usos to authenticated;
  create policy "admin e vendedor gerenciam cupons_varejo_usos da propria operacao"
    on public.cupons_varejo_usos for all
    using (public.meu_papel() in ('admin', 'vendedor') and operacao_id = public.operacao_atual())
    with check (public.meu_papel() in ('admin', 'vendedor') and operacao_id = public.operacao_atual());

  drop function if exists public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean
  );

  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid,
    p_cashback_resgatar_id uuid default null::uuid,
    p_conceder_cashback boolean default false,
    p_cupom_id uuid default null::uuid
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
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

    -- Cupom (achado no code-review original do cashback, reaplicado aqui: a mesma necessidade de
    -- "resgate/concessao viajam JUNTO com a venda" vale pro cupom -- se a checagem de elegibilidade
    -- falhar, a venda inteira tambem nao e criada, nao so o desconto do cupom).
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
      -- Fuso de Brasilia explicito (nao current_date puro, que e UTC nesta sessao) -- mesma razao
      -- de sempre: entre 21h e 23h59 de Brasilia, UTC ja virou o dia seguinte.
      if v_cupom.validade < (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'Esse cupom ja venceu';
      end if;

      select cpf_cnpj into v_cpf from public.clientes where id = p_cliente_id;
      if v_cpf is null or trim(v_cpf) = '' then
        raise exception 'Cliente sem CPF/CNPJ cadastrado -- nao e possivel aplicar cupom';
      end if;

      -- Confere que o desconto registrado na venda cobre pelo menos o valor do cupom (defesa em
      -- profundidade igual ao cashback -- resgatar_cashback faz a mesma checagem contra o proprio
      -- desconto): sem isso, uma chamada direta com p_cupom_id preenchido mas p_valor_desconto menor
      -- (ou zero) marcaria o cupom como usado sem o cliente ter recebido o desconto correspondente.
      select subtotal into v_subtotal_venda from public.vendas where id = v_venda_id;
      v_desconto_cupom := case v_cupom.tipo
        when 'percentual' then public.arredondar_moeda(v_subtotal_venda * v_cupom.valor / 100)
        else public.arredondar_moeda(v_cupom.valor)
      end;
      if p_valor_desconto < v_desconto_cupom then
        raise exception 'O desconto da venda (%) e menor que o desconto do cupom (%) -- o cliente precisa receber o valor do cupom como desconto', p_valor_desconto, v_desconto_cupom;
      end if;

      -- O UNIQUE (cupom_id, cliente_id) e quem garante "nunca duas vezes pro mesmo cliente" -- aqui
      -- so traduz a violacao numa mensagem de negocio, em vez de deixar o 23503/23505 cru estourar.
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
  $fn$;

  revoke execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid
  ) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid
  ) to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cupons_varejo' and column_name = 'validade' and is_nullable = 'NO') then
    raise exception 'FALHA: cupons_varejo.validade nao existe ou aceita null';
  end if;
  if to_regclass('public.cupons_varejo_usos') is null then
    raise exception 'FALHA: tabela cupons_varejo_usos nao existe';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cupons_varejo_usos_cupom_cliente_key') then
    raise exception 'FALHA: constraint unique (cupom_id, cliente_id) nao existe';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'cupons_varejo_usos' and c.relrowsecurity
  ) then
    raise exception 'FALHA: RLS nao esta habilitado em cupons_varejo_usos';
  end if;

  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean)') is not null then
    raise exception 'FALHA: assinatura antiga (sem cupom) de registrar_venda_varejo_com_cashback ainda existe';
  end if;
  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid)') is null then
    raise exception 'FALHA: registrar_venda_varejo_com_cashback (assinatura com cupom) nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda_varejo_com_cashback (nova)';
  end if;
  if has_function_privilege('anon', 'public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em registrar_venda_varejo_com_cashback (nova)';
  end if;

  raise notice 'VERIFICACAO OK: cupons_varejo.validade, cupons_varejo_usos e registrar_venda_varejo_com_cashback (com p_cupom_id) no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_cliente_com_cpf uuid;
  v_cliente_sem_cpf uuid;
  v_outro_cliente uuid;
  v_prod uuid;
  v_var uuid;
  v_cupom_id uuid;
  v_cupom_vencido_id uuid;
  v_venda1 uuid;
  v_n int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  insert into public.clientes (nome, telefone, cpf_cnpj) values ('ZZ ENSAIO CUPOM COM CPF', '35955554444', '11122233344') returning id into v_cliente_com_cpf;
  insert into public.clientes (nome, telefone) values ('ZZ ENSAIO CUPOM SEM CPF', '35944443333') returning id into v_cliente_sem_cpf;
  insert into public.clientes (nome, telefone, cpf_cnpj) values ('ZZ ENSAIO CUPOM OUTRO CLIENTE', '35933332222', '55566677788') returning id into v_outro_cliente;

  insert into public.cupons_varejo (codigo, tipo, valor, validade) values ('ZZLIMITE10', 'percentual', 10, current_date + 30) returning id into v_cupom_id;
  insert into public.cupons_varejo (codigo, tipo, valor, validade) values ('ZZVENCIDO', 'percentual', 10, current_date - 1) returning id into v_cupom_vencido_id;

  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO CUPOM LIMITE', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZCUPLIM', 'atributos', '{}'::jsonb, 'preco_venda', 100.00)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var, 10, 20.00, 'ensaio cupom limite');

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- T1. Cliente com CPF usa o cupom (10%% de desconto numa venda de R$100 = R$10) -> sucesso, grava
  -- cupons_varejo_usos.
  v_venda1 := public.registrar_venda_varejo_com_cashback(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
    gen_random_uuid(), null, null, null, null, 10.00, 0, v_cliente_com_cpf,
    null, false, v_cupom_id
  );
  select count(*) into v_n from public.cupons_varejo_usos where cupom_id = v_cupom_id and cliente_id = v_cliente_com_cpf and venda_id = v_venda1;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: uso do cupom nao foi registrado'; end if;

  -- T2. MESMO cliente tenta usar o MESMO cupom de novo (venda nova) -> bloqueado.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
      gen_random_uuid(), null, null, null, null, 10.00, 0, v_cliente_com_cpf,
      null, false, v_cupom_id
    );
    raise exception 'TESTE FALHOU [T2]: cliente conseguiu usar o mesmo cupom duas vezes';
  exception
    when others then
      if sqlerrm <> 'Esse cliente ja usou este cupom' then raise; end if;
  end;

  -- T3. OUTRO cliente (CPF diferente) consegue usar o MESMO cupom normalmente -- prova que o limite
  -- e por cliente, nao global.
  declare
    v_venda_outro uuid;
    v_n2 int;
  begin
    v_venda_outro := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
      gen_random_uuid(), null, null, null, null, 10.00, 0, v_outro_cliente,
      null, false, v_cupom_id
    );
    select count(*) into v_n2 from public.cupons_varejo_usos where cupom_id = v_cupom_id and cliente_id = v_outro_cliente;
    if v_n2 <> 1 then raise exception 'TESTE FALHOU [T3]: outro cliente deveria poder usar o mesmo cupom'; end if;
  end;

  -- T4. Cupom vencido -> bloqueado.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
      gen_random_uuid(), null, null, null, null, 10.00, 0, v_cliente_com_cpf,
      null, false, v_cupom_vencido_id
    );
    raise exception 'TESTE FALHOU [T4]: cupom vencido deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm <> 'Esse cupom ja venceu' then raise; end if;
  end;

  -- T5. Cliente SEM cpf_cnpj cadastrado -> bloqueado.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
      gen_random_uuid(), null, null, null, null, 10.00, 0, v_cliente_sem_cpf,
      null, false, v_cupom_id
    );
    raise exception 'TESTE FALHOU [T5]: cliente sem CPF deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm <> 'Cliente sem CPF/CNPJ cadastrado -- nao e possivel aplicar cupom' then raise; end if;
  end;

  -- T6. Sem cliente selecionado -> bloqueado.
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
      gen_random_uuid(), null, null, null, null, 10.00, 0, null,
      null, false, v_cupom_id
    );
    raise exception 'TESTE FALHOU [T6]: cupom sem cliente selecionado deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm <> 'Selecione o cliente para usar um cupom' then raise; end if;
  end;

  -- T7. Desconto informado menor que o valor do cupom -- defesa em profundidade (normalmente a tela
  -- ja manda o valor certo, mas uma chamada direta nao pode "economizar" no desconto).
  declare
    v_outro_cliente2 uuid;
  begin
    insert into public.clientes (nome, telefone, cpf_cnpj) values ('ZZ ENSAIO CUPOM DESCONTO BAIXO', '35922221111', '99988877766') returning id into v_outro_cliente2;
    begin
      perform public.registrar_venda_varejo_com_cashback(
        v_sessao,
        jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
        jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 99.00)),
        gen_random_uuid(), null, null, null, null, 1.00, 0, v_outro_cliente2,
        null, false, v_cupom_id
      );
      raise exception 'TESTE FALHOU [T7]: desconto menor que o valor do cupom deveria ter sido bloqueado';
    exception
      when others then
        if sqlerrm !~ 'e menor que o desconto do cupom' then raise; end if;
    end;
  end;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T7 (cupom registra uso por cliente, bloqueia reuso do mesmo cliente, libera outro cliente, bloqueia vencido/sem CPF/sem cliente/desconto insuficiente).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid
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

  drop table if exists public.cupons_varejo_usos;
  alter table public.cupons_varejo drop column if exists validade;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cupons_varejo' and column_name = 'validade')
     or to_regclass('public.cupons_varejo_usos') is not null
     or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean, uuid)') is not null
     or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, boolean)') is null then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu cupons_varejo/registrar_venda_varejo_com_cashback ao estado original.';
  end if;

  raise exception 'ENSAIO OK: cupons_varejo.validade (obrigatoria), cupons_varejo_usos (unique por cupom+cliente) e registrar_venda_varejo_com_cashback com p_cupom_id no lugar, testado (T1 a T7) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
