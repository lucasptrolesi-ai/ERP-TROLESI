/** "1.234,56" ou "1234.56" -> 1234.56 (0 se inválido) */
export function parseMoeda(valor: string): number {
  return Number(valor.replace(",", ".")) || 0;
}
