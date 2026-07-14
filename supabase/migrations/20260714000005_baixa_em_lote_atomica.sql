-- Achado no code-review (4 agentes independentes bateram nisso): a baixa em
-- lote fazia um loop de updates um por um, sem transação — uma falha no
-- meio do lote deixava parte já baixada e parte não, sem jeito de saber o
-- que sobrou; e não checava se o título já tinha sido baixado por outra
-- pessoa antes de sobrescrever (podia apagar um valor_pago/observação já
-- registrados). Um único UPDATE atômico resolve os dois problemas: todo o
-- lote sobe ou nenhum sobe, e `valor_pago = valor` (referência de coluna,
-- não parâmetro fixo) pega o valor de face de cada linha automaticamente,
-- sem precisar de um SELECT antes.

create or replace function public.dar_baixa_em_lote_contas_receber(
  p_ids uuid[],
  p_pago_em timestamptz,
  p_forma_pagamento public.forma_pagamento
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_linhas integer;
begin
  update public.contas_receber
    set situacao = 'pago',
        pago_em = p_pago_em,
        valor_pago = valor,
        forma_pagamento_baixa = p_forma_pagamento,
        observacao_baixa = null
    where id = any(p_ids) and situacao != 'pago';

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;
