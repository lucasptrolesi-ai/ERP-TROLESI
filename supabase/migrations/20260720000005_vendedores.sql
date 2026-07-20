-- Fase 2 (documento mestre, seção 21): vendedores como cadastro próprio,
-- estendendo `profiles` (não substitui — todo profile com papel 'vendedor'
-- pode ou não ter uma linha aqui; sem linha = sem comissão configurada
-- ainda). O CÁLCULO de comissão (seção 21, "evento gerador configurável")
-- é Fase 4 — esta migration só guarda a configuração base.
--
-- ROLLBACK:
-- drop trigger if exists vendedores_atualizado_em on public.vendedores;
-- drop table if exists public.vendedores;
-- drop type if exists public.evento_comissao;

create type public.evento_comissao as enum ('venda', 'recebimento', 'fechamento_mensal');

create table public.vendedores (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  comissao_percentual numeric(5, 2),
  comissao_fixa numeric(10, 2),
  evento_gerador public.evento_comissao not null default 'venda',
  meta_mensal numeric(10, 2),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.vendedores enable row level security;

create policy "admin gerencia vendedores"
  on public.vendedores for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

create policy "vendedor le a propria configuracao"
  on public.vendedores for select
  using (profile_id = auth.uid());

create trigger vendedores_atualizado_em
  before update on public.vendedores
  for each row execute function public.set_atualizado_em();
