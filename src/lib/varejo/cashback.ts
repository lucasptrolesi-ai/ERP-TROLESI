/** Quanto um cashback resgatado pode cobrir no carrinho atual (PDV Varejo, Fase 3 de 3 — cliente,
 * cupom, cashback). Mesma conta que registrar_venda faz pro total final (totalItens - desconto do
 * carrinho + acréscimo) — esquecer o acréscimo aqui sub-estimava o espaço disponível e bloqueava, na
 * tela, um resgate que o servidor aceitaria (achado de code review, 2026-10-21). O cashback é
 * resgatado inteiro (a tabela não guarda "uso parcial"), então quem usa este número só decide se um
 * valor específico CABE (`valor <= espacoParaCashback(...)`), nunca o aplica parcialmente. */
export function espacoParaCashback(totalItens: number, numDescontoCarrinho: number, numAcrescimo: number): number {
  return totalItens - numDescontoCarrinho + numAcrescimo;
}
