-- Fase 3 (documento mestre, "Núcleo do PDV"): schema de suporte às regras
-- reais de desconto automático, parcelamento por limiar, primeira
-- compra/reativação, status de venda externa pendente de lançamento no
-- GMax, e idempotência de finalização de venda.
--
-- ROLLBACK:
-- drop function if exists public.estatisticas_cliente(uuid);
-- drop table if exists public.faixas_parcelamento;
-- alter table public.pedidos
--   drop column if exists parcelas_planejadas,
--   drop column if exists lancado_gmax_em,
--   drop column if exists lancado_gmax_por,
--   drop column if exists idempotency_key;
-- (os valores novos de enum "aguardando_lancamento_gmax"/"lancado_gmax" em
-- status_pedido e "debito" em forma_pagamento NÃO têm rollback direto —
-- Postgres não permite remover valor de enum; se precisar reverter de
-- verdade, seria necessário recriar o tipo do zero, como já foi feito em
-- 20260713000013_pagamento_flexivel.sql.)

-- "aguardando_lancamento_gmax": a venda foi registrada no PDV pra uso
-- externo, mas ainda não afeta estoque/financeiro — é isso, formalizado como
-- regra de negócio testável, em vez da reutilização informal de 'orcamento'
-- que estava sendo cogitada antes desta fase.
alter type public.status_pedido add value if not exists 'aguardando_lancamento_gmax';
-- "lancado_gmax": o usuário já conferiu/digitou manualmente essa venda no
-- GMax — vira o registro de que aquilo não precisa mais aparecer como
-- pendente na lista de "vendas a lançar".
alter type public.status_pedido add value if not exists 'lancado_gmax';

-- "débito" precisa ser uma forma de pagamento própria, distinta de
-- "cartão de crédito" — o desconto automático de 7% (seção 8) e a ausência
-- de parcelamento se aplicam só ao débito, nunca ao crédito.
alter type public.forma_pagamento add value if not exists 'debito';

-- Faixas de parcelamento sem juros por valor mínimo da venda (seção 9):
-- mais de uma faixa por forma de pagamento, escolhe-se sempre a maior faixa
-- que a venda atinge. Ex.: cartão de crédito — R$200 libera até 2x,
-- R$300 libera até 3x. `condicoes_pagamento` (Fase 2) continua valendo pro
-- valor mínimo absoluto da forma de pagamento e pro teto de parcelas com
-- juros — este complementa com a parte graduada.
create table public.faixas_parcelamento (
  id uuid primary key default gen_random_uuid(),
  forma_pagamento public.forma_pagamento not null,
  valor_minimo numeric(10, 2) not null,
  parcelas_sem_juros integer not null,
  unique (forma_pagamento, valor_minimo)
);

alter table public.faixas_parcelamento enable row level security;

create policy "leitura geral de faixas_parcelamento"
  on public.faixas_parcelamento for select
  using (auth.uid() is not null);

create policy "admin gerencia faixas_parcelamento"
  on public.faixas_parcelamento for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

insert into public.faixas_parcelamento (forma_pagamento, valor_minimo, parcelas_sem_juros) values
  ('cartao_credito', 200, 2),
  ('cartao_credito', 300, 3)
on conflict (forma_pagamento, valor_minimo) do nothing;

-- Guarda o parcelamento planejado (valor + vencimento de cada parcela) NO
-- PRÓPRIO PEDIDO — não em contas_receber — pra vendas "aguardando_lancamento
-- _gmax" continuarem imprimindo cupom/promissórias completos sem criar
-- receita/financeiro real (decisão da fusão do documento mestre com o PDV
-- modo anotação, 2026-07-20).
alter table public.pedidos
  add column parcelas_planejadas jsonb,
  add column lancado_gmax_em timestamptz,
  add column lancado_gmax_por uuid references public.profiles (id),
  -- Chave de idempotência opcional, gerada no cliente (crypto.randomUUID())
  -- na hora de abrir o formulário de venda — clique duplo/duas abas reenviam
  -- a MESMA chave, então o unique index rejeita a segunda tentativa em vez
  -- de criar duas vendas.
  add column idempotency_key uuid unique;

-- Estatísticas de cliente pra primeira compra/reativação (seção 10):
-- "venda válida" pra esse histórico é qualquer pedido que não seja
-- 'orcamento' (ainda não confirmado) nem 'cancelado' — inclui
-- 'aguardando_lancamento_gmax' porque, do ponto de vista do cliente, a venda
-- aconteceu de verdade (ele levou a mercadoria e pagou); só não afetou nosso
-- estoque/financeiro interno ainda. Essa é uma decisão de modelagem
-- explícita, não um detalhe óbvio — documentada aqui de propósito.
create or replace function public.estatisticas_cliente(p_cliente_id uuid)
returns table (
  data_primeira_compra timestamptz,
  data_ultima_compra timestamptz,
  total_comprado numeric,
  meses_inatividade numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    min(criado_em) as data_primeira_compra,
    max(criado_em) as data_ultima_compra,
    coalesce(sum(total), 0) as total_comprado,
    case
      when max(criado_em) is null then null
      else extract(epoch from (now() - max(criado_em))) / (60 * 60 * 24 * 30.0)
    end as meses_inatividade
  from public.pedidos
  where cliente_id = p_cliente_id
    and status not in ('orcamento', 'cancelado');
$$;
