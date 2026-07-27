-- Trolesi Vision AI: cadastro de produto por foto.
-- Campos descritivos sugeridos pela IA seguem a mesma filosofia de
-- categoria/subcategoria já usada em produtos: texto livre, não normalizado
-- em tabela à parte — a escala da Trolesi não justifica isso.
-- codigo_barras segue o mesmo padrão de codigo_interno (migration
-- 20260713000011): único quando preenchido, não obrigatório.
--
-- Toda a migration é escrita de forma idempotente (if not exists / drop
-- policy if exists) — pode ser rodada de novo sem erro caso uma tentativa
-- anterior tenha parado no meio.

alter table public.produtos
  add column if not exists descricao text,
  add column if not exists material text,
  add column if not exists cor text,
  add column if not exists banho text,
  add column if not exists acabamento text,
  add column if not exists pedra text,
  add column if not exists estilo text,
  add column if not exists formato text,
  add column if not exists tamanho_aproximado text,
  add column if not exists colecao text,
  add column if not exists marca text,
  add column if not exists tags text[],
  add column if not exists codigo_barras text;

create unique index if not exists produtos_codigo_barras_key
  on public.produtos (codigo_barras)
  where codigo_barras is not null;

-- Múltiplas fotos por produto (frente/verso/detalhe). `foto_url` continua
-- existindo e passa a ser preenchida a partir da foto "frente" ao salvar —
-- não quebra o grid de cards do Estoque nem a busca de produtos em Pedidos,
-- que já leem esse campo direto.
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

-- Aprendizado contínuo: toda vez que o operador corrige um valor sugerido
-- pela IA, fica registrado aqui. As últimas correções por campo entram como
-- exemplos few-shot no próximo prompt de análise — sem precisar treinar ou
-- fazer fine-tuning de modelo nenhum.
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

-- Bucket de Storage para as fotos originais e a versão com fundo removido.
-- Público de leitura: as fotos alimentam o catálogo/PDV/vitrine (mesmo uso já
-- previsto para `foto_url`, que hoje é sempre um link público do Drive/GMax) —
-- não há dado sensível numa foto de produto. Escrita continua restrita.
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
