/** Comissão de vendedor (seção 21) — percentual, fixa, ou os dois somados.
 * O evento gerador (venda/recebimento/fechamento mensal) é configurável por
 * vendedor (`vendedores.evento_gerador`), não fixo no código — esta função
 * só calcula o valor, quem decide QUANDO chamar é o fluxo correspondente a
 * cada evento (ainda não implementado nesta fase). */
export function calcularComissao(valorBase: number, percentual: number | null, fixa: number | null): number {
  const porPercentual = percentual ? Math.round(valorBase * (percentual / 100) * 100) / 100 : 0;
  const porFixa = fixa ?? 0;
  return Math.round((porPercentual + porFixa) * 100) / 100;
}
