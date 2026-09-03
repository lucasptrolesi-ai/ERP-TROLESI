export type TipoCupomEvento = "percentual" | "valor";

/** Desconto de um cupom aplicado sobre o subtotal da venda (PDV Eventos,
 * pedido do usuário 2026-09-03). Percentual nunca passa de 100% do
 * subtotal (a própria constraint do banco já trava o cupom em <= 100 no
 * cadastro); valor fixo nunca desconta mais do que o subtotal vale — uma
 * venda nunca fica com total negativo por causa de um cupom. */
export function calcularDescontoCupom(tipo: TipoCupomEvento, valor: number, subtotal: number): number {
  const desconto = tipo === "percentual" ? subtotal * (valor / 100) : valor;
  return Math.round(Math.min(Math.max(desconto, 0), subtotal) * 100) / 100;
}
