/** Multiplicador comercial padrão (seção 6 do documento mestre) — usado só
 * como valor inicial de referência. O multiplicador de verdade é sempre o do
 * produto (`produtos.multiplicador`), nunca este hardcoded, pra permitir
 * multiplicador por produto/material/categoria sem mudar código. */
export const MULTIPLICADOR_PADRAO = 2.8;

/** Preço unitário = código da peça × multiplicador, arredondado pra 2 casas.
 * Extraído de `novo-pedido.tsx` pra virar uma regra testável isoladamente
 * (seção 4 do documento mestre: cálculo comercial não pode ser só uma
 * expressão solta dentro de um componente). */
export function calcularPrecoUnitario(codigoPeca: number, multiplicador: number): number {
  return Math.round(codigoPeca * multiplicador * 100) / 100;
}

/** Preço unitário pra material com cotação diária (ouro/cobre — seção 6,
 * decisão registrada em pending_decisions pra 'multiplicador_ouro_cobre'):
 * a cotação do dia é o preço-base do grama, o multiplicador comercial
 * aplica a margem em cima — sem isso a venda sairia a preço de custo. */
export function calcularPrecoPorCotacao(peso: number, cotacaoGrama: number, multiplicador: number): number {
  return Math.round(peso * cotacaoGrama * multiplicador * 100) / 100;
}
