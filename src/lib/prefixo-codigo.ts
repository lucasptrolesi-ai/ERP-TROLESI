/** Prefixo de letras do início do código (esquema do usuário: PA, BL, BLF,
 * CA...) — usado tanto pra agrupar por seção na tela de Estoque quanto pra
 * identificar categoria de produto em regras comerciais (ex: promoção de
 * berloques, cupom-evento.ts). */
export function prefixoCodigo(codigo: string): string {
  return codigo.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "Outros";
}
