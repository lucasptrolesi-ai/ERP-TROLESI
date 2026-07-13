-- Fase 2: Produtos & Estoque.
-- Cadastro único: unifica os 44 produtos reais do GMax com as 791 fotos do
-- catálogo (Google Drive, projeto da landing page) — decisão de 2026-07-11.
-- Categoria/sub/subsub ficam como texto (não normalizado em tabelas à parte):
-- na escala da Trolesi (algumas dezenas de grupos) isso é suficiente e evita
-- complexidade sem benefício real.

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null,
  subcategoria text,
  subsubcategoria text,
  foto_url text,
  custo numeric(10, 2) not null default 0,
  multiplicador numeric(4, 2) not null default 2.8,
  preco numeric(10, 2) generated always as (round(custo * multiplicador, 2)) stored,
  quantidade_estoque integer not null default 0,
  estoque_minimo integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index produtos_categoria_idx on public.produtos (categoria);

create type public.tipo_movimento_estoque as enum ('entrada', 'saida', 'ajuste');

create table public.movimentos_estoque (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete restrict,
  tipo public.tipo_movimento_estoque not null,
  quantidade integer not null check (quantidade > 0),
  motivo text,
  pedido_id uuid, -- FK adicionada na migration de pedidos (evita dependência circular de arquivo)
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

alter table public.produtos enable row level security;
alter table public.movimentos_estoque enable row level security;

create policy "time logado lê produtos"
  on public.produtos for select
  using (auth.uid() is not null);

create policy "estoque e admin gerenciam produtos"
  on public.produtos for all
  using (public.meu_papel() in ('admin', 'estoque'))
  with check (public.meu_papel() in ('admin', 'estoque'));

create policy "time logado lê movimentos de estoque"
  on public.movimentos_estoque for select
  using (auth.uid() is not null);

-- Vendedor entra aqui também: fechar um pedido gera uma saída de estoque.
create policy "estoque, vendedor e admin lançam movimentos"
  on public.movimentos_estoque for insert
  with check (public.meu_papel() in ('admin', 'estoque', 'vendedor'));

create policy "estoque e admin corrigem movimentos"
  on public.movimentos_estoque for update
  using (public.meu_papel() in ('admin', 'estoque'))
  with check (public.meu_papel() in ('admin', 'estoque'));
