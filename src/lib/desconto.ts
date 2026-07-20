import type { FormaPagamento } from "@/lib/types";

/** Percentual automático por forma de pagamento (seção 8 do documento
 * mestre) — dinheiro à vista 10%, Pix 7%, débito 7%. Cartão de crédito e
 * promissória não têm desconto automático (o parcelamento é a vantagem
 * deles). Nunca hardcoded dentro de um cálculo maior — sempre nomeado aqui,
 * pra virar configurável via tabela no dia que precisar. */
const PERCENTUAL_DESCONTO_AUTOMATICO: Partial<Record<FormaPagamento, number>> = {
  dinheiro: 0.1,
  pix: 0.07,
  debito: 0.07,
};

export function percentualDescontoAutomatico(forma: FormaPagamento): number {
  return PERCENTUAL_DESCONTO_AUTOMATICO[forma] ?? 0;
}

export type ItemParaDesconto = { valor: number; elegivel: boolean };

export type ResultadoDesconto = {
  subtotalBruto: number;
  totalNaoElegivel: number;
  baseElegivel: number;
  percentual: number;
  valorDesconto: number;
  totalFinal: number;
};

/** Fornitura (e qualquer item marcado como não-elegível) nunca entra na
 * base de cálculo do desconto — o desconto é aplicado só sobre o restante,
 * nunca sobre o total bruto (seção 8). */
export function calcularDescontoAutomatico(itens: ItemParaDesconto[], forma: FormaPagamento): ResultadoDesconto {
  const subtotalBruto = itens.reduce((soma, item) => soma + item.valor, 0);
  const totalNaoElegivel = itens.filter((item) => !item.elegivel).reduce((soma, item) => soma + item.valor, 0);
  const baseElegivel = subtotalBruto - totalNaoElegivel;
  const percentual = percentualDescontoAutomatico(forma);
  const valorDesconto = Math.round(baseElegivel * percentual * 100) / 100;

  return {
    subtotalBruto,
    totalNaoElegivel,
    baseElegivel,
    percentual,
    valorDesconto,
    totalFinal: subtotalBruto - valorDesconto,
  };
}
