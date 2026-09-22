import { arredondarMoeda, lerMoeda } from "@/lib/dinheiro";
import type { ItemCatalogo } from "@/lib/varejo/tipos";

/**
 * Matemática do carrinho do PDV — pura, sem estado do React, para poder ser testada sem montar
 * componente nenhum. É esta lógica (não a tela) que decide se um item está abaixo do preço mínimo
 * e, portanto, se a venda exige PIN de supervisor: extraída e testada depois que o code review
 * (2026-09-22) achou que a única cobertura dessa regra era do lado do servidor (SQL), sem nada do
 * lado do cliente que garantisse que a tela realmente pede a autorização antes de deixar finalizar.
 */

export type ItemCarrinho = { variacao: ItemCatalogo; quantidade: number; precoTexto: string };

export type LinhaCarrinho = ItemCarrinho & { preco: number; abaixoDoPiso: boolean };

/** O preço praticado nunca passa do preço de tabela (o cliente só pode pedir desconto, nunca acréscimo). */
export function calcularLinha(item: ItemCarrinho): LinhaCarrinho {
  const preco = Math.min(lerMoeda(item.precoTexto) ?? item.variacao.preco_venda, item.variacao.preco_venda);
  const piso = item.variacao.preco_minimo ?? item.variacao.preco_venda;
  return { ...item, preco, abaixoDoPiso: preco < piso };
}

export type TotaisCarrinho = { subtotal: number; total: number; precisaAutorizacao: boolean };

export function calcularTotais(linhas: LinhaCarrinho[]): TotaisCarrinho {
  const subtotal = arredondarMoeda(linhas.reduce((s, l) => s + l.variacao.preco_venda * l.quantidade, 0));
  const total = arredondarMoeda(linhas.reduce((s, l) => s + l.preco * l.quantidade, 0));
  return { subtotal, total, precisaAutorizacao: linhas.some((l) => l.abaixoDoPiso) };
}

/** Troco só existe em dinheiro; nunca negativo (a tela barra finalizar se o recebido for menor que o total). */
export function calcularTroco(forma: string, valorRecebido: number, total: number): number {
  return forma === "dinheiro" ? Math.max(0, arredondarMoeda(valorRecebido - total)) : 0;
}
