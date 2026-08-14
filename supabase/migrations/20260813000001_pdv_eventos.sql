-- PDV Eventos (pedido direto do usuário, 2026-08-13) — estoque e vendas
-- totalmente separados do ERP real, pra evento temporário (Agroshow):
-- preço fixo digitado direto no cadastro (sem código×multiplicador), venda
-- anônima (sem cliente), sem passar pelas regras de negócio do PDV real
-- (mínimo de primeira compra, comissão automática, promissória). Ver
-- DECISIONS.md pro desenho completo.
--
-- ROLLBACK:
-- drop function if exists public.criar_venda_evento(jsonb, text, numeric, integer, uuid);
-- drop function if exists public.definir_codigo_produto_evento();
-- drop table if exists public.vendas_evento_itens;
-- drop table if exists public.vendas_evento;
-- drop table if exists public.produtos_evento;
-- drop sequence if exists public.produtos_evento_codigo_seq;

create table public.produtos_evento (
  id uuid primary key default gen_random_uuid(),
  codigo_interno text not null,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  quantidade_estoque integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create unique index produtos_evento_codigo_interno_key on public.produtos_evento (codigo_interno);

-- Mesmo padrão já usado em produtos.codigo_interno (migration 20260729000001):
-- numeração sequencial automática, curta o bastante pra caber num código de
-- barras de etiqueta pequena.
create sequence public.produtos_evento_codigo_seq;

create or replace function public.definir_codigo_produto_evento()
returns trigger
language plpgsql
as $$
begin
  if new.codigo_interno is null or btrim(new.codigo_interno) = '' then
    new.codigo_interno := nextval('public.produtos_evento_codigo_seq')::text;
  end if;
  return new;
end;
$$;

create trigger trg_produtos_evento_codigo
  before insert on public.produtos_evento
  for each row
  execute function public.definir_codigo_produto_evento();

create table public.vendas_evento (
  id uuid primary key default gen_random_uuid(),
  numero integer generated always as identity,
  forma_pagamento text not null check (forma_pagamento in ('dinheiro', 'pix', 'cartao_vista', 'cartao_parcelado')),
  numero_parcelas integer not null default 1,
  subtotal numeric(10, 2) not null,
  valor_desconto numeric(10, 2) not null default 0,
  total numeric(10, 2) not null,
  status text not null default 'faturado' check (status in ('faturado', 'cancelado')),
  idempotency_key uuid,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

create unique index vendas_evento_idempotency_key_idx
  on public.vendas_evento (idempotency_key)
  where idempotency_key is not null;

create table public.vendas_evento_itens (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas_evento (id) on delete cascade,
  -- set null (não restrict) de propósito: o produto do evento pode ser
  -- desativado/apagado depois que o evento acabar sem travar o histórico
  -- de venda — nome/preço já ficam gravados na própria linha (snapshot).
  produto_evento_id uuid references public.produtos_evento (id) on delete set null,
  nome text not null,
  quantidade integer not null check (quantidade > 0),
  preco_unitario numeric(10, 2) not null,
  subtotal numeric(10, 2) generated always as (round(quantidade * preco_unitario, 2)) stored
);

alter table public.produtos_evento enable row level security;
alter table public.vendas_evento enable row level security;
alter table public.vendas_evento_itens enable row level security;

create policy "time logado le produtos_evento"
  on public.produtos_evento for select
  using (auth.uid() is not null);

create policy "admin e vendedor gerenciam produtos_evento"
  on public.produtos_evento for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));

create policy "time logado le vendas_evento"
  on public.vendas_evento for select
  using (auth.uid() is not null);

create policy "time logado le vendas_evento_itens"
  on public.vendas_evento_itens for select
  using (auth.uid() is not null);

-- Sem policy de insert direta em vendas_evento/vendas_evento_itens de
-- propósito — só grava através de criar_venda_evento (SECURITY DEFINER),
-- mesmo espírito de pedidos/pedido_itens: garante que subtotal/total e a
-- baixa de estoque sempre acontecem juntos, nunca um insert avulso
-- dessincronizado.

create or replace function public.criar_venda_evento(
  p_itens jsonb, -- [{produto_evento_id, quantidade, preco_unitario, nome}]
  p_forma_pagamento text,
  p_valor_desconto numeric default 0,
  p_numero_parcelas integer default 1,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade integer;
  v_preco numeric(10, 2);
  v_estoque_atual integer;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_idempotency_key is not null then
    select id into v_venda_id from public.vendas_evento where idempotency_key = p_idempotency_key;
    if v_venda_id is not null then
      return v_venda_id;
    end if;
  end if;

  if p_forma_pagamento not in ('dinheiro', 'pix', 'cartao_vista', 'cartao_parcelado') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'A venda precisa de pelo menos um item.';
  end if;

  if coalesce(p_valor_desconto, 0) < 0 then
    raise exception 'Desconto não pode ser negativo.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_preco := (v_item ->> 'preco_unitario')::numeric;
    if v_preco < 0 then
      raise exception 'Preço unitário não pode ser negativo.';
    end if;
    if (v_item ->> 'quantidade')::integer <= 0 then
      raise exception 'Quantidade precisa ser maior que zero.';
    end if;
    v_subtotal := v_subtotal + (v_item ->> 'quantidade')::integer * v_preco;
  end loop;

  v_total := v_subtotal - coalesce(p_valor_desconto, 0);
  if v_total < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  begin
    insert into public.vendas_evento (
      forma_pagamento, numero_parcelas, subtotal, valor_desconto, total, idempotency_key, criado_por
    )
    values (
      p_forma_pagamento, greatest(1, p_numero_parcelas), v_subtotal, coalesce(p_valor_desconto, 0), v_total,
      p_idempotency_key, auth.uid()
    )
    returning id into v_venda_id;
  exception
    when unique_violation then
      select id into v_venda_id from public.vendas_evento where idempotency_key = p_idempotency_key;
      return v_venda_id;
  end;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_produto_id := (v_item ->> 'produto_evento_id')::uuid;
    v_quantidade := (v_item ->> 'quantidade')::integer;
    v_preco := (v_item ->> 'preco_unitario')::numeric;

    select quantidade_estoque into v_estoque_atual from public.produtos_evento where id = v_produto_id for update;
    if v_estoque_atual is null then
      raise exception 'Produto do evento não encontrado.';
    end if;
    -- Estoque negativo autorizado, mesmo padrão já usado no estoque real
    -- (2026-07-21) — só desconta, não bloqueia a venda por causa de uma
    -- contagem desatualizada no meio do evento.
    update public.produtos_evento set quantidade_estoque = quantidade_estoque - v_quantidade
      where id = v_produto_id;

    insert into public.vendas_evento_itens (venda_id, produto_evento_id, nome, quantidade, preco_unitario)
    values (v_venda_id, v_produto_id, coalesce(v_item ->> 'nome', ''), v_quantidade, v_preco);
  end loop;

  return v_venda_id;
end;
$$;

revoke all on function public.criar_venda_evento(jsonb, text, numeric, integer, uuid) from public;
grant execute on function public.criar_venda_evento(jsonb, text, numeric, integer, uuid) to authenticated;
