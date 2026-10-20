/** Desconto de um cupom aplicado sobre o total de itens do carrinho (PDV Varejo, Fase 2 de 3 —
 * cliente, cupom, cashback — pedido do usuário 2026-10-19/20). Mesma regra do cupom do PDV Eventos
 * (`calcularDescontoCupom` em cupom-evento.ts): percentual nunca passa de 100% (a própria constraint
 * do banco já trava o cupom em <= 100 no cadastro); valor fixo nunca desconta mais do que o total
 * vale — uma venda nunca fica negativa por causa de um cupom. */
export function calcularDescontoCupomVarejo(tipo: "percentual" | "valor", valor: number, totalItens: number): number {
  const desconto = tipo === "percentual" ? totalItens * (valor / 100) : valor;
  return Math.round(Math.min(Math.max(desconto, 0), totalItens) * 100) / 100;
}
