-- Fase 2: Pedidos (tela "Novo Pedido" do mockup).
-- Sem consignação/maleta (removida do escopo em 2026-07-11).

create type public.status_pedido as enum ('orcamento', 'pedido', 'faturado', 'cancelado');
create type public.forma_pagamento as enum ('a_vista', 'cartao_3x');

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero integer generated always as identity,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  vendedor_id uuid references public.profiles (id),
  status public.status_pedido not null default 'orcamento',
  forma_pagamento public.forma_pagamento,
  subtotal numeric(10, 2) not null default 0,
  desconto numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  produto_id uuid not null references public.produtos (id) on delete restrict,
  quantidade integer not null check (quantidade > 0),
  preco_unitario numeric(10, 2) not null,
  subtotal numeric(10, 2) generated always as (round(quantidade * preco_unitario, 2)) stored
);

alter table public.movimentos_estoque
  add constraint movimentos_estoque_pedido_id_fkey
  foreign key (pedido_id) references public.pedidos (id) on delete set null;

alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;

create policy "time logado lê pedidos"
  on public.pedidos for select
  using (auth.uid() is not null);

create policy "vendedor e admin gerenciam pedidos"
  on public.pedidos for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));

create policy "time logado lê itens de pedido"
  on public.pedido_itens for select
  using (auth.uid() is not null);

create policy "vendedor e admin gerenciam itens de pedido"
  on public.pedido_itens for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));
