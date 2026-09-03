-- Cupom de desconto no PDV Eventos (pedido direto do usuário, 2026-09-03,
-- durante o Agroshow): digita o código do cupom na venda e o desconto é
-- calculado sozinho, em vez do vendedor ter que saber de cabeça (ou
-- combinar por WhatsApp) quanto cada promoção vale em R$.
--
-- Primeira versão enxuta (decisão do usuário): só ativo/inativo, sem limite
-- de uso — controle de "parar de aceitar" é simplesmente desativar o cupom.
-- Tipo percentual ou valor fixo, configurável por cupom.
--
-- Sem function de busca: a lista de cupons já é carregada inteira na tela
-- (aba "Cupons" do PDV Eventos, mesmo espírito de produtos_evento), então a
-- tela de Vender aplica o cupom procurando na mesma lista já em memória
-- (client-side, ver calcularDescontoCupom em cupom-evento.ts) — sem ida ao
-- servidor no meio de uma venda, o que importa numa feira com wifi
-- instável. Não muda criar_venda_evento nem adiciona validação nova na
-- hora de fechar a venda: p_valor_desconto já aceita qualquer valor >= 0
-- desde sempre (20260813000001) — o vendedor já podia digitar um desconto
-- manual livremente. O cupom só preenche esse mesmo campo calculado, não é
-- uma nova fronteira de segurança.
--
-- ROLLBACK:
-- drop table if exists public.cupons_evento;
-- drop type if exists public.tipo_cupom_evento;

create type public.tipo_cupom_evento as enum ('percentual', 'valor');

create table public.cupons_evento (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  tipo public.tipo_cupom_evento not null,
  valor numeric(10, 2) not null check (valor > 0),
  ativo boolean not null default true,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  constraint cupons_evento_percentual_max check (tipo <> 'percentual' or valor <= 100)
);

-- Case-insensitive: "agroshow10" e "AGROSHOW10" são o mesmo cupom.
create unique index cupons_evento_codigo_key on public.cupons_evento (upper(codigo));

alter table public.cupons_evento enable row level security;

create policy "admin e vendedor gerenciam cupons_evento"
  on public.cupons_evento for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));
