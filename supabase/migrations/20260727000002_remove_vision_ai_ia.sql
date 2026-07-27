-- O usuário decidiu não usar mais IA (Google Gemini) no cadastro de produto —
-- o preenchimento continua manual, só a checagem de duplicidade (por
-- categoria/subcategoria/material/cor) foi mantida, agora embutida direto no
-- formulário de "Novo produto" em vez de um fluxo por foto separado.
-- Ver DECISIONS.md (2026-07-27) para o contexto completo.
--
-- ROLLBACK:
-- create table public.produto_ia_correcoes (
--   id uuid primary key default gen_random_uuid(),
--   produto_id uuid references public.produtos (id) on delete set null,
--   campo text not null,
--   valor_sugerido text,
--   valor_corrigido text not null,
--   criado_por uuid references public.profiles (id),
--   criado_em timestamptz not null default now()
-- );
-- create table public.produto_imagens (
--   id uuid primary key default gen_random_uuid(),
--   produto_id uuid not null references public.produtos (id) on delete cascade,
--   tipo public.tipo_imagem_produto not null,
--   storage_path text not null,
--   criado_em timestamptz not null default now()
-- );
-- alter table public.produtos add column tags text[];
-- insert into storage.buckets (id, name, public) values ('produtos-fotos', 'produtos-fotos', true);

drop table if exists public.produto_ia_correcoes;
drop table if exists public.produto_imagens;
drop type if exists public.tipo_imagem_produto;

alter table public.produtos drop column if exists tags;

drop policy if exists "leitura pública de fotos de produto" on storage.objects;
drop policy if exists "estoque e admin sobem fotos de produto" on storage.objects;
drop policy if exists "estoque e admin removem fotos de produto" on storage.objects;

-- O bucket em si não sai daqui: Supabase bloqueia DELETE direto em
-- storage.objects/storage.buckets via SQL (trigger storage.protect_delete,
-- proteção contra perda de dado órfão) — precisa ser removido pelo Dashboard
-- (Storage → produtos-fotos → Delete bucket) ou pela Storage API/CLI.
