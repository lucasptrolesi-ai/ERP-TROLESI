-- Botão "Importar vendas do GMax" (pedido direto do usuário, 2026-07-24) —
-- repete sob demanda a reconciliação manual feita em 2026-07-23 (vendas
-- lançadas direto no GMax, fora do PDV do Trolesi). Ver DECISIONS.md pro
-- desenho completo (agente local `gmax-agent/` lê o Firebird e escreve um
-- relatório; só a function abaixo, dentro do Next.js, grava de verdade).
--
-- Revisão independente (subagent) achou 2 furos reais na 1ª versão desta
-- migration antes dela ser aplicada:
-- 1. Não existia policy de UPDATE em solicitacoes_importacao_gmax — o
--    `.update({status: "concluido"})` feito pela Server Action (cliente
--    normal, RLS-bound) depois de chamar a function ia silenciosamente
--    afetar 0 linhas, sem erro nenhum. A solicitação ficava travada em
--    "pronto_para_revisao" pra sempre, e a trava contra confirmar duas
--    vezes (que dependia do status virar "concluido") nunca funcionava de
--    verdade.
-- 2. Sem trava de linha, duas confirmações concorrentes da mesma
--    solicitação (duas abas, ou um duplo clique) podiam rodar a function
--    duas vezes em paralelo.
-- Fix: a function agora recebe o ID da solicitação (não o relatório
-- direto), faz `select ... for update` na própria linha (trava real,
-- serializa qualquer concorrência) e ela mesma grava o status final
-- "concluido" no fim — tudo dentro da mesma transação, sem depender de
-- nenhum update feito de fora com um client RLS-bound.
--
-- ROLLBACK:
-- drop function if exists public.importar_pedidos_gmax(uuid);
-- drop table if exists public.solicitacoes_importacao_gmax;
-- alter table public.pedidos drop column if exists gmax_pedido_id;

-- Rastreia qual pedido Trolesi já veio de qual pedido GMax — evita
-- reimportar a mesma venda duas vezes mesmo que o botão seja clicado várias
-- vezes ou dois agentes rodem por engano.
alter table public.pedidos
  add column gmax_pedido_id integer unique;

create table public.solicitacoes_importacao_gmax (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pendente'
    check (status in ('pendente', 'pronto_para_revisao', 'bloqueado', 'concluido', 'erro')),
  relatorio jsonb,
  erro text,
  solicitado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create index solicitacoes_importacao_gmax_pendentes_idx
  on public.solicitacoes_importacao_gmax (criado_em)
  where status = 'pendente';

alter table public.solicitacoes_importacao_gmax enable row level security;

-- Mais sensível que a fila de impressão (`solicitacoes_impressao`): aqui o
-- conteúdo é dado financeiro real antes de virar pedido de verdade — só
-- admin dispara e revisa. Só o agente (service_role, ignora RLS) e a
-- function abaixo (security definer) mudam o status.
create policy "admin cria solicitacao de importacao gmax"
  on public.solicitacoes_importacao_gmax for insert
  to authenticated
  with check (public.meu_papel() = 'admin');

create policy "admin le solicitacoes de importacao gmax"
  on public.solicitacoes_importacao_gmax for select
  to authenticated
  using (public.meu_papel() = 'admin');

-- Grava de verdade os pedidos resolvidos pelo agente (relatorio jsonb no
-- formato { "pedidos": [ { gmax_pedido_id, forma_pagamento, vendedor_id,
-- cliente: {id|null, nome, cpf_cnpj, telefone}, itens: [{produto_id,
-- quantidade, preco_unitario}], parcelas: [{valor, vencimento}] } ] }).
-- Numa transação só (tudo-ou-nada) — mesma lição já aplicada em
-- dar_baixa_em_lote_contas_receber: um lote de N pedidos não pode ficar
-- "3 de 6 entraram e não dá pra saber quais" se algo falhar no meio.
--
-- Não passa por criar_pedido() de propósito — mesmo motivo já documentado
-- na importação histórica da Fase 5 (migracao-dados/importar_dados_reais.py):
-- criar_pedido tem regras (mínimo de primeira compra, comissão automática,
-- idempotência de venda nova) que não fazem sentido pra registrar uma venda
-- que já aconteceu de verdade fora do app.
create or replace function public.importar_pedidos_gmax(p_solicitacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relatorio jsonb;
  v_status text;
  v_pedido jsonb;
  v_item jsonb;
  v_parcela jsonb;
  v_cliente jsonb;
  v_cliente_id uuid;
  v_cpf_cnpj text;
  v_pedido_id uuid;
  v_gmax_id integer;
  v_subtotal numeric(10, 2);
  v_produto_id uuid;
  v_quantidade integer;
  v_preco numeric(10, 2);
  v_numero_parcelas integer;
  v_indice integer;
  v_importados integer := 0;
  v_ja_existentes integer := 0;
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  -- `for update` trava a linha da solicitação até o fim da transação —
  -- uma segunda confirmação concorrente da mesma solicitação fica esperando
  -- aqui, e quando essa espera termina o status já não é mais
  -- 'pronto_para_revisao' (viramos 'concluido' abaixo), então ela cai no
  -- `raise exception` e nunca reimporta nada.
  select relatorio, status into v_relatorio, v_status
    from public.solicitacoes_importacao_gmax
    where id = p_solicitacao_id
    for update;

  if v_status is null then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status <> 'pronto_para_revisao' then
    raise exception 'Essa solicitação já foi processada ou não está pronta para revisão.';
  end if;

  for v_pedido in select * from jsonb_array_elements(v_relatorio -> 'pedidos')
  loop
    v_gmax_id := (v_pedido ->> 'gmax_pedido_id')::integer;

    if exists (select 1 from public.pedidos where gmax_pedido_id = v_gmax_id) then
      v_ja_existentes := v_ja_existentes + 1;
      continue;
    end if;

    v_cliente := v_pedido -> 'cliente';
    v_cliente_id := nullif(v_cliente ->> 'id', '')::uuid;
    -- '' e null tratados igual — o agente manda cpf_cnpj vazio como null,
    -- mas trata os dois do mesmo jeito por segurança: nunca casar dois
    -- clientes diferentes por "cpf vazio == cpf vazio" (achado da revisão:
    -- duas vendas com CPF em branco no mesmo lote seriam fundidas num único
    -- cliente errado se comparássemos strings vazias literalmente).
    v_cpf_cnpj := nullif(trim(v_cliente ->> 'cpf_cnpj'), '');
    if v_cliente_id is null and v_cpf_cnpj is not null then
      select id into v_cliente_id from public.clientes where cpf_cnpj = v_cpf_cnpj;
    end if;
    if v_cliente_id is null then
      insert into public.clientes (nome, cpf_cnpj, telefone)
      values (v_cliente ->> 'nome', v_cpf_cnpj, v_cliente ->> 'telefone')
      returning id into v_cliente_id;
    end if;

    v_subtotal := 0;
    for v_item in select * from jsonb_array_elements(v_pedido -> 'itens')
    loop
      v_subtotal := v_subtotal + (v_item ->> 'quantidade')::integer * (v_item ->> 'preco_unitario')::numeric;
    end loop;

    v_numero_parcelas := greatest(1, coalesce(jsonb_array_length(v_pedido -> 'parcelas'), 0));

    insert into public.pedidos (
      cliente_id, vendedor_id, status, forma_pagamento,
      subtotal, valor_desconto, valor_acrescimo, total, numero_parcelas, gmax_pedido_id
    )
    values (
      v_cliente_id,
      nullif(v_pedido ->> 'vendedor_id', '')::uuid,
      'faturado',
      (v_pedido ->> 'forma_pagamento')::public.forma_pagamento,
      v_subtotal, 0, 0, v_subtotal, v_numero_parcelas, v_gmax_id
    )
    returning id into v_pedido_id;

    for v_item in select * from jsonb_array_elements(v_pedido -> 'itens')
    loop
      v_produto_id := (v_item ->> 'produto_id')::uuid;
      v_quantidade := (v_item ->> 'quantidade')::integer;
      v_preco := (v_item ->> 'preco_unitario')::numeric;

      insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
      values (v_pedido_id, v_produto_id, v_quantidade, v_preco);

      update public.produtos set quantidade_estoque = quantidade_estoque - v_quantidade
        where id = v_produto_id;

      insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo, pedido_id, criado_por)
      values (v_produto_id, 'saida', v_quantidade, 'Venda (importação GMax #' || v_gmax_id || ')', v_pedido_id, auth.uid());
    end loop;

    if jsonb_array_length(v_pedido -> 'parcelas') > 0 then
      v_indice := 0;
      for v_parcela in select * from jsonb_array_elements(v_pedido -> 'parcelas')
      loop
        v_indice := v_indice + 1;
        insert into public.contas_receber (
          pedido_id, cliente_id, valor, vencimento, forma_pagamento, numero_parcela, total_parcelas
        )
        values (
          v_pedido_id, v_cliente_id,
          (v_parcela ->> 'valor')::numeric,
          (v_parcela ->> 'vencimento')::date,
          (v_pedido ->> 'forma_pagamento')::public.forma_pagamento,
          v_indice, v_numero_parcelas
        );
      end loop;
    end if;

    v_importados := v_importados + 1;
  end loop;

  update public.solicitacoes_importacao_gmax
    set status = 'concluido', concluido_em = now()
    where id = p_solicitacao_id;

  return jsonb_build_object('importados', v_importados, 'ja_existentes', v_ja_existentes);
end;
$$;

revoke all on function public.importar_pedidos_gmax(uuid) from public;
grant execute on function public.importar_pedidos_gmax(uuid) to authenticated;
