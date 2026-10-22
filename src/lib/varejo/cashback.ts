import { arredondarMoeda } from "@/lib/dinheiro";

/** Quanto um cashback resgatado pode cobrir no carrinho atual (PDV Varejo, Fase 3 de 3 — cliente,
 * cupom, cashback). Mesma conta que registrar_venda faz pro total final (totalItens - desconto do
 * carrinho + acréscimo) — esquecer o acréscimo aqui sub-estimava o espaço disponível e bloqueava, na
 * tela, um resgate que o servidor aceitaria (achado de code review, 2026-10-21). O cashback é
 * resgatado inteiro (a tabela não guarda "uso parcial"), então quem usa este número só decide se um
 * valor específico CABE (`valor <= espacoParaCashback(...)`), nunca o aplica parcialmente. */
export function espacoParaCashback(totalItens: number, numDescontoCarrinho: number, numAcrescimo: number): number {
  return totalItens - numDescontoCarrinho + numAcrescimo;
}

/** Cashback a conceder nesta venda — sempre 10% do total final pago (pedido do usuário, 2026-10-22:
 * "compro 100, tenho 10 de cashback na próxima compra" — não é mais livre, o vendedor só decide SE
 * concede, não quanto). Só pra preview na tela antes de finalizar; o valor de verdade é recalculado
 * no banco (`conceder_cashback`, a partir de `vendas.total` já persistido), que é a fonte real —
 * esta função nunca é o que decide o valor gravado, só evita a tela ficar muda até a venda existir. */
export function valorCashbackAConceder(total: number): number {
  return arredondarMoeda(total * 0.1);
}
