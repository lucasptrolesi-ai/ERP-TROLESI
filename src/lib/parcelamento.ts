export type FaixaParcelamento = { valorMinimo: number; parcelasSemJuros: number };

/** Parcelamento sem juros por limiar de valor (seção 9 do documento mestre):
 * a partir de R$200 → até 2x, a partir de R$300 → até 3x. Escolhe sempre a
 * maior faixa que a venda atinge — nunca a interface deve oferecer uma
 * opção de parcela que a venda não atinge (mesmo desabilitada). */
export function maxParcelasSemJuros(valorVenda: number, faixas: FaixaParcelamento[]): number {
  const elegiveis = faixas.filter((faixa) => valorVenda >= faixa.valorMinimo);
  if (elegiveis.length === 0) return 1;
  return Math.max(...elegiveis.map((faixa) => faixa.parcelasSemJuros));
}
