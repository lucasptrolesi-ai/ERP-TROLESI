-- Fase 2: Cadastros — clientes e fornecedores.
-- Sem tipo "revendedora" separado (decisão de 2026-07-11): todo comprador é
-- um cliente comum, com cadastro.

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf_cnpj text,
  telefone text,
  cidade text,
  uf text,
  endereco text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index clientes_cpf_cnpj_key on public.clientes (cpf_cnpj) where cpf_cnpj is not null;

create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  telefone text,
  cidade text,
  uf text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.clientes enable row level security;
alter table public.fornecedores enable row level security;

-- Cadastros ficam legíveis por qualquer funcionário logado (vendedor precisa
-- achar cliente pra vender, financeiro precisa achar fornecedor pra pagar) —
-- só admin e o próprio papel "dono" da área escrevem.
create policy "time logado lê clientes"
  on public.clientes for select
  using (auth.uid() is not null);

create policy "vendedor e admin gerenciam clientes"
  on public.clientes for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));

create policy "time logado lê fornecedores"
  on public.fornecedores for select
  using (auth.uid() is not null);

create policy "financeiro e admin gerenciam fornecedores"
  on public.fornecedores for all
  using (public.meu_papel() in ('admin', 'financeiro'))
  with check (public.meu_papel() in ('admin', 'financeiro'));
