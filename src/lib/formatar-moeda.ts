export function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Versão compacta ("R$ 1,2 mil") pra rótulo de eixo, onde precisão exata
 * não importa e espaço é curto — nunca usar em valor que o usuário vai
 * conferir contra um total real (aí é sempre formatarMoeda). */
export function formatarMoedaCompacta(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
