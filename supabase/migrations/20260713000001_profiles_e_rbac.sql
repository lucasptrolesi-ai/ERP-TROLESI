-- Fase 2: papéis internos (RBAC) e perfis de usuário.
-- Cada funcionário do time (dono, vendedor, financeiro, estoque) é um auth.users
-- do Supabase; esta tabela guarda o papel dele para as políticas de RLS.

create extension if not exists pgcrypto;

create type public.papel_usuario as enum ('admin', 'vendedor', 'financeiro', 'estoque');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  papel public.papel_usuario not null default 'vendedor',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

comment on table public.profiles is 'Funcionários internos com acesso ao ERP. Um por auth.users.';

-- Novo usuário do Supabase Auth ganha um profile automaticamente.
-- Papel entra como "vendedor" (o menos privilegiado dos operacionais) por
-- padrão seguro; só um admin promove para admin/financeiro/estoque depois.
create function public.handle_novo_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, papel)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', new.email), 'vendedor');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_novo_usuario();

-- Helper para as políticas de RLS das próximas migrations: le o papel do
-- usuário autenticado sem re-disparar RLS na própria tabela profiles
-- (security definer + search_path fixo evita o loop e o hijack de search_path).
create function public.meu_papel()
returns public.papel_usuario
language sql
stable
security definer set search_path = public
as $$
  select papel from public.profiles where id = auth.uid();
$$;

alter table public.profiles enable row level security;

create policy "usuario vê o próprio perfil"
  on public.profiles for select
  using (id = auth.uid());

create policy "admin vê todos os perfis"
  on public.profiles for select
  using (public.meu_papel() = 'admin');

create policy "admin gerencia perfis"
  on public.profiles for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');
