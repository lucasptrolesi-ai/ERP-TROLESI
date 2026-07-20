-- Fase 2 (documento mestre, seções 9 e 18): motor de condições de pagamento
-- configurável e locais de estoque nomeados.
--
-- Decisão de não-destruição: o enum `forma_pagamento` (dinheiro/pix/
-- cartao_credito/promissoria) já é usado em `pedidos`, `contas_receber`,
-- `contas_pagar` e funciona hoje — NÃO é substituído por uma tabela dinâmica
-- (isso exigiria trocar o tipo de várias colunas em produção, um risco alto
-- sem benefício imediato). Em vez disso, `condicoes_pagamento` guarda as
-- REGRAS (valor mínimo, parcelas sem/com juros) por forma de pagamento já
-- existente — consumida pela validação da Fase 3, sem tocar no que já roda.
--
-- ROLLBACK:
-- drop table if exists public.movimentos_estoque_local;
-- alter table public.movimentos_estoque drop column if exists local_id;
-- alter table public.produtos drop column if exists localizacao_id;
-- drop table if exists public.locais_estoque;
-- drop table if exists public.condicoes_pagamento;

create table public.condicoes_pagamento (
  id uuid primary key default gen_random_uuid(),
  forma_pagamento public.forma_pagamento not null unique,
  valor_minimo_venda numeric(10, 2) not null default 0,
  parcelas_maximas_sem_juros integer not null default 1,
  parcelas_maximas_com_juros integer not null default 1,
  valor_minimo_parcela numeric(10, 2) not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

alter table public.condicoes_pagamento enable row level security;

create policy "leitura geral de condicoes_pagamento"
  on public.condicoes_pagamento for select
  using (auth.uid() is not null);

create policy "admin gerencia condicoes_pagamento"
  on public.condicoes_pagamento for insert
  with check (public.meu_papel() = 'admin');

create policy "admin atualiza condicoes_pagamento"
  on public.condicoes_pagamento for update
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

create trigger condicoes_pagamento_atualizado_em
  before update on public.condicoes_pagamento
  for each row execute function public.set_atualizado_em();

-- Seed com as regras já confirmadas no documento mestre (seção 9): a partir
-- de R$200 até 2x sem juros / a partir de R$300 até 3x sem juros / até 12x
-- com juros da maquininha. Dinheiro/Pix não têm parcelamento (1x).
insert into public.condicoes_pagamento (forma_pagamento, valor_minimo_venda, parcelas_maximas_sem_juros, parcelas_maximas_com_juros)
values
  ('dinheiro', 0, 1, 1),
  ('pix', 0, 1, 1),
  ('cartao_credito', 200, 3, 12),
  ('promissoria', 0, 4, 4)
on conflict (forma_pagamento) do nothing;

create table public.locais_estoque (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  tipo text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.locais_estoque enable row level security;

create policy "leitura geral de locais_estoque"
  on public.locais_estoque for select
  using (auth.uid() is not null);

create policy "admin e estoque gerenciam locais_estoque"
  on public.locais_estoque for all
  using (public.meu_papel() in ('admin', 'estoque'))
  with check (public.meu_papel() in ('admin', 'estoque'));

insert into public.locais_estoque (nome, tipo) values
  ('Loja', 'loja'),
  ('Estoque principal', 'principal'),
  ('Mostruário', 'mostruario'),
  ('Avarias', 'avarias'),
  ('Garantias', 'garantias'),
  ('Abatimentos recebidos', 'abatimentos'),
  ('Reservados', 'reservados'),
  ('Em trânsito', 'transito')
on conflict (nome) do nothing;

-- Localização "padrão" do produto (onde ele normalmente fica) — aditivo,
-- nullable: produtos existentes continuam funcionando sem local definido.
alter table public.produtos
  add column localizacao_id uuid references public.locais_estoque (id) on delete set null;

-- Local por movimentação — aditivo, nullable: movimentos já gravados (venda,
-- entrada) continuam válidos sem local; a granularidade por local é usada só
-- a partir de agora, quando o PDV/Estoque passar a informar isso (Fase 3/4).
alter table public.movimentos_estoque
  add column local_id uuid references public.locais_estoque (id) on delete set null;
