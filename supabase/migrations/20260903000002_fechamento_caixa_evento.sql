-- Fechamento de caixa no PDV Eventos (pedido direto do usuário,
-- 2026-09-03, durante o Agroshow): abrir o caixa do dia com um valor
-- inicial (troco), registrar entradas/retiradas de dinheiro quando
-- precisar, e fechar o caixa imprimindo o resumo na Elgin.
--
-- Movimento (entrada/retirada) é insert-only (mesmo espírito de
-- movimentacoes_estoque_evento, 20260824000001) — registro de auditoria de
-- dinheiro entrando/saindo do caixa, não um valor editável livremente
-- depois. Abertura e fechamento também são insert-only e sem trava de "só
-- uma vez por dia": evento ao vivo, mais seguro poder refazer/corrigir
-- lançando de novo (sempre usa o mais recente do dia) do que bloquear.
--
-- ROLLBACK:
-- drop table if exists public.fechamentos_caixa_evento;
-- drop table if exists public.aberturas_caixa_evento;
-- drop table if exists public.movimentos_caixa_evento;
-- drop type if exists public.tipo_movimento_caixa_evento;

create type public.tipo_movimento_caixa_evento as enum ('entrada', 'retirada');

create table public.movimentos_caixa_evento (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_movimento_caixa_evento not null,
  valor numeric(10, 2) not null check (valor > 0),
  motivo text not null,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

alter table public.movimentos_caixa_evento enable row level security;

create policy "admin e vendedor leem movimentos_caixa_evento"
  on public.movimentos_caixa_evento for select
  using (public.meu_papel() in ('admin', 'vendedor'));

create policy "admin e vendedor criam movimentos_caixa_evento"
  on public.movimentos_caixa_evento for insert
  with check (public.meu_papel() in ('admin', 'vendedor'));

-- Valor com que o caixa abriu no dia (troco inicial). Uma linha por
-- lançamento, não por dia — se abrir duas vezes no mesmo dia por engano, o
-- app sempre usa a mais recente (mesmo raciocínio de cotacoes_diarias, só
-- que sem a constraint de unicidade por dia, pra simplificar).
create table public.aberturas_caixa_evento (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  valor numeric(10, 2) not null default 0,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

alter table public.aberturas_caixa_evento enable row level security;

create policy "admin e vendedor leem aberturas_caixa_evento"
  on public.aberturas_caixa_evento for select
  using (public.meu_papel() in ('admin', 'vendedor'));

create policy "admin e vendedor criam aberturas_caixa_evento"
  on public.aberturas_caixa_evento for insert
  with check (public.meu_papel() in ('admin', 'vendedor'));

create table public.fechamentos_caixa_evento (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  valor_abertura numeric(10, 2) not null default 0,
  total_dinheiro numeric(10, 2) not null default 0,
  total_pix numeric(10, 2) not null default 0,
  total_cartao_vista numeric(10, 2) not null default 0,
  total_cartao_parcelado numeric(10, 2) not null default 0,
  total_descontos numeric(10, 2) not null default 0,
  total_entradas numeric(10, 2) not null default 0,
  total_retiradas numeric(10, 2) not null default 0,
  saldo_dinheiro numeric(10, 2) not null default 0,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

alter table public.fechamentos_caixa_evento enable row level security;

create policy "admin e vendedor leem fechamentos_caixa_evento"
  on public.fechamentos_caixa_evento for select
  using (public.meu_papel() in ('admin', 'vendedor'));

create policy "admin e vendedor criam fechamentos_caixa_evento"
  on public.fechamentos_caixa_evento for insert
  with check (public.meu_papel() in ('admin', 'vendedor'));
