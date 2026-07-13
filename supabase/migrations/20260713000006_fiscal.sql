-- Fase 2: Fiscal / NF-e — modo "gerar XML para conferência" (Fase 4/6 do
-- plano). Esta migration só cria a estrutura; nenhuma emissão real acontece
-- até a Fase 7, e só com autorização explícita do usuário.
-- O certificado A1 nunca é armazenado aqui — fica custodiado direto na
-- plataforma do provedor de NF-e (Focus NFe); esta tabela guarda só o
-- resultado (XML gerado, status, protocolo), não credenciais.

create type public.status_nota_fiscal as enum ('rascunho', 'gerada', 'validada', 'autorizada', 'cancelada');

create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete restrict,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  status public.status_nota_fiscal not null default 'rascunho',
  xml text,
  chave_acesso text,
  protocolo text,
  valor_total numeric(10, 2) not null,
  validada_por uuid references public.profiles (id),
  validada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.notas_fiscais enable row level security;

create policy "financeiro e admin gerenciam notas fiscais"
  on public.notas_fiscais for all
  using (public.meu_papel() in ('admin', 'financeiro'))
  with check (public.meu_papel() in ('admin', 'financeiro'));

create policy "vendedor lê notas dos próprios pedidos"
  on public.notas_fiscais for select
  using (
    public.meu_papel() = 'vendedor'
    and exists (
      select 1 from public.pedidos p
      where p.id = notas_fiscais.pedido_id and p.vendedor_id = auth.uid()
    )
  );
