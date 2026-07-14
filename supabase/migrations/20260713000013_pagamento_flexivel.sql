-- Fase 4: reformula formas de pagamento a pedido do usuário, depois de ver
-- o fluxo funcionando. Substitui o antigo "a_vista" (7% fixo) por desconto
-- e acréscimo manuais e flexíveis, e adiciona dinheiro/pix/cartão em várias
-- parcelas/promissória. Só há dados de teste até agora, por isso o enum é
-- recriado em vez de remendado (Postgres não deixa remover valor de enum).

-- será recriada com a assinatura nova na próxima migration
drop function if exists public.criar_pedido(uuid, public.forma_pagamento, public.status_pedido, jsonb);

alter type public.forma_pagamento rename to forma_pagamento_old;
create type public.forma_pagamento as enum ('dinheiro', 'pix', 'cartao_credito', 'promissoria');

alter table public.pedidos alter column forma_pagamento drop default;
alter table public.pedidos
  alter column forma_pagamento type public.forma_pagamento
  using (
    case forma_pagamento::text
      when 'a_vista' then 'pix'
      when 'cartao_3x' then 'cartao_credito'
      else null
    end
  )::public.forma_pagamento;

alter table public.contas_receber
  alter column forma_pagamento type public.forma_pagamento
  using (
    case forma_pagamento::text
      when 'a_vista' then 'pix'
      when 'cartao_3x' then 'cartao_credito'
      else null
    end
  )::public.forma_pagamento;

drop type public.forma_pagamento_old;

-- Desconto/acréscimo manuais (substituem o desconto fixo de 7%). Percentual
-- fica guardado só pra exibição/conferência — quem manda no valor final é
-- sempre valor_desconto/valor_acrescimo.
alter table public.pedidos
  add column percentual_desconto numeric(5, 2),
  add column valor_acrescimo numeric(10, 2) not null default 0,
  add column percentual_acrescimo numeric(5, 2),
  add column numero_parcelas integer not null default 1;

-- "desconto" já existia (Fase 2) — vira explicitamente valor_desconto pra
-- combinar com o par percentual/valor de cada lado.
alter table public.pedidos rename column desconto to valor_desconto;

-- Numeração de parcela ("nº do pedido - parcela/total", ex: 12-1/4) pra
-- cartão parcelado e promissória — cada parcela vira uma linha em
-- contas_receber.
alter table public.contas_receber
  add column numero_parcela integer,
  add column total_parcelas integer;
