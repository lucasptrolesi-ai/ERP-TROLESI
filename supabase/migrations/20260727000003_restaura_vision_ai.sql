-- O usuário reconsiderou de novo: quer manter a IA (Google Gemini) no
-- cadastro de produto por foto. Esta migration desfaz exatamente o que
-- 20260727000002 tinha desfeito, recriando o que o Vision AI precisa —
-- mesmas definições da migration original 20260725000001_produtos_vision_ai.sql.
-- Ver DECISIONS.md (2026-07-27) para o histórico completo dessa ida e volta.
--
-- ROLLBACK: ver 20260727000002_remove_vision_ai_ia.sql (faz exatamente isso).

alter table public.produtos
  add column if not exists tags text[];

do $$ begin
  create type public.tipo_imagem_produto as enum ('frente', 'verso', 'detalhe', 'outra');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.produto_imagens (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete cascade,
  tipo public.tipo_imagem_produto not null,
  storage_path text not null,
  criado_em timestamptz not null default now()
);

create index if not exists produto_imagens_produto_id_idx on public.produto_imagens (produto_id);

alter table public.produto_imagens enable row level security;

drop policy if exists "time logado lê imagens de produto" on public.produto_imagens;
create policy "time logado lê imagens de produto"
  on public.produto_imagens for select
  using (auth.uid() is not null);

drop policy if exists "estoque e admin gerenciam imagens de produto" on public.produto_imagens;
create policy "estoque e admin gerenciam imagens de produto"
  on public.produto_imagens for all
  using (public.meu_papel() in ('admin', 'estoque'))
  with check (public.meu_papel() in ('admin', 'estoque'));

create table if not exists public.produto_ia_correcoes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid references public.produtos (id) on delete set null,
  campo text not null,
  valor_sugerido text,
  valor_corrigido text not null,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

create index if not exists produto_ia_correcoes_campo_idx on public.produto_ia_correcoes (campo);

alter table public.produto_ia_correcoes enable row level security;

drop policy if exists "time logado lê correções de IA" on public.produto_ia_correcoes;
create policy "time logado lê correções de IA"
  on public.produto_ia_correcoes for select
  using (auth.uid() is not null);

drop policy if exists "estoque e admin registram correções de IA" on public.produto_ia_correcoes;
create policy "estoque e admin registram correções de IA"
  on public.produto_ia_correcoes for insert
  with check (public.meu_papel() in ('admin', 'estoque'));

insert into storage.buckets (id, name, public)
values ('produtos-fotos', 'produtos-fotos', true)
on conflict (id) do nothing;

drop policy if exists "leitura pública de fotos de produto" on storage.objects;
create policy "leitura pública de fotos de produto"
  on storage.objects for select
  using (bucket_id = 'produtos-fotos');

drop policy if exists "estoque e admin sobem fotos de produto" on storage.objects;
create policy "estoque e admin sobem fotos de produto"
  on storage.objects for insert
  with check (bucket_id = 'produtos-fotos' and public.meu_papel() in ('admin', 'estoque'));

drop policy if exists "estoque e admin removem fotos de produto" on storage.objects;
create policy "estoque e admin removem fotos de produto"
  on storage.objects for delete
  using (bucket_id = 'produtos-fotos' and public.meu_papel() in ('admin', 'estoque'));
