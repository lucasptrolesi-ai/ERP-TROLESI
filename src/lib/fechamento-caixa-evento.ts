import type { FormaPagamentoEvento } from "./types";

export type ResumoFechamentoCaixa = {
  valorAbertura: number;
  porFormaPagamento: Record<FormaPagamentoEvento, number>;
  totalVendido: number;
  totalDescontos: number;
  totalEntradas: number;
  totalRetiradas: number;
  saldoDinheiro: number;
};

/** Resumo do fechamento de caixa do dia (PDV Eventos, pedido do usuário
 * 2026-09-03): soma vendas faturadas por forma de pagamento e ajusta o
 * saldo em dinheiro pelo troco de abertura e pelos movimentos manuais —
 * só dinheiro físico passa pela gaveta, pix e cartão nunca entram nessa
 * conta. */
export function calcularResumoFechamentoCaixa(
  vendas: { forma_pagamento: FormaPagamentoEvento; total: number; valor_desconto: number }[],
  movimentos: { tipo: "entrada" | "retirada"; valor: number }[],
  valorAbertura: number,
): ResumoFechamentoCaixa {
  const porFormaPagamento: Record<FormaPagamentoEvento, number> = {
    dinheiro: 0,
    pix: 0,
    cartao_vista: 0,
    cartao_parcelado: 0,
  };
  let totalVendido = 0;
  let totalDescontos = 0;

  for (const venda of vendas) {
    porFormaPagamento[venda.forma_pagamento] += venda.total;
    totalVendido += venda.total;
    totalDescontos += venda.valor_desconto;
  }

  let totalEntradas = 0;
  let totalRetiradas = 0;
  for (const m of movimentos) {
    if (m.tipo === "entrada") totalEntradas += m.valor;
    else totalRetiradas += m.valor;
  }

  const saldoDinheiro = valorAbertura + porFormaPagamento.dinheiro + totalEntradas - totalRetiradas;

  return { valorAbertura, porFormaPagamento, totalVendido, totalDescontos, totalEntradas, totalRetiradas, saldoDinheiro };
}
