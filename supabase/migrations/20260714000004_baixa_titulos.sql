-- Revisão do Financeiro pedida pelo usuário depois da importação dos dados
-- reais (149 contas_receber em aberto, a maioria vencida): a baixa de um
-- título precisa registrar mais do que só "pago"/"não pago" — data real do
-- pagamento, valor efetivamente recebido (pode diferir do valor da parcela
-- por desconto de quitação ou juro/multa) e a forma de pagamento realmente
-- usada, que pode ser diferente da forma prevista no pedido.
--
-- `forma_pagamento` da tabela não é sobrescrito — continua sendo a forma
-- prevista. `forma_pagamento_baixa` é o que de fato aconteceu na baixa,
-- separado pra "desfazer baixa" conseguir reverter sem perder o dado
-- original.

alter table public.contas_receber
  add column valor_pago numeric(10, 2),
  add column forma_pagamento_baixa public.forma_pagamento,
  add column observacao_baixa text;

alter table public.contas_pagar
  add column valor_pago numeric(10, 2),
  add column forma_pagamento_baixa public.forma_pagamento,
  add column observacao_baixa text;
