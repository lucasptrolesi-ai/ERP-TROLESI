import { prefixoCodigo } from "@/lib/prefixo-codigo";

const PREFIXO_BERLOQUE = "BL";
const QUANTIDADE_MINIMA = 3;
const PRECO_PROMOCIONAL = 49.9;

/** Promoção de berloques do PDV Eventos (pedido do usuário, 2026-09-03):
 * peças com código começando em "BL" saem por R$49,90 cada quando o
 * cliente leva 3 ou mais — conta qualquer combinação de berloques no
 * carrinho, não precisa ser 3 do mesmo código. Devolve o valor a descontar
 * do subtotal (0 se não bateu a quantidade mínima, ou se o preço normal já
 * fosse menor que o promocional — nunca aumenta o preço). */
export function calcularDescontoBerloques(
  itens: { codigo_interno: string; quantidade: number; preco_unitario: number }[],
): number {
  const berloques = itens.filter((i) => prefixoCodigo(i.codigo_interno) === PREFIXO_BERLOQUE);
  const totalUnidades = berloques.reduce((soma, i) => soma + i.quantidade, 0);
  if (totalUnidades < QUANTIDADE_MINIMA) return 0;

  const valorNormal = berloques.reduce((soma, i) => soma + i.quantidade * i.preco_unitario, 0);
  const valorPromocional = totalUnidades * PRECO_PROMOCIONAL;
  return Math.max(0, Math.round((valorNormal - valorPromocional) * 100) / 100);
}
