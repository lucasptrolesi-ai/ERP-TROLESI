-- Fase 2: Financeiro — contas a receber e a pagar.

create type public.situacao_conta as enum ('em_dia', 'atrasado', 'pago');

create table public.contas_receber (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos (id) on delete set null,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  valor numeric(10, 2) not null,
  vencimento date not null,
  situacao public.situacao_conta not null default 'em_dia',
  pago_em timestamptz,
  forma_pagamento public.forma_pagamento,
  criado_em timestamptz not null default now()
);

create table public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  descricao text not null,
  valor numeric(10, 2) not null,
  vencimento date not null,
  situacao public.situacao_conta not null default 'em_dia',
  pago_em timestamptz,
  criado_em timestamptz not null default now()
);

alter table public.contas_receber enable row level security;
alter table public.contas_pagar enable row level security;

-- Financeiro é o único papel operacional com acesso; vendedor não vê
-- valores a receber de outros vendedores, admin vê tudo.
create policy "financeiro e admin gerenciam contas a receber"
  on public.contas_receber for all
  using (public.meu_papel() in ('admin', 'financeiro'))
  with check (public.meu_papel() in ('admin', 'financeiro'));

create policy "financeiro e admin gerenciam contas a pagar"
  on public.contas_pagar for all
  using (public.meu_papel() in ('admin', 'financeiro'))
  with check (public.meu_papel() in ('admin', 'financeiro'));
