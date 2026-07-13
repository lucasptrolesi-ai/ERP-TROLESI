/** Filtro simples client-side (nome + campos extras) — usado em listas pequenas (dezenas a ~100 linhas). */
export function filtra<T extends { nome: string }>(
  itens: T[],
  busca: string,
  extra: (item: T) => string = () => "",
): T[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return itens;
  return itens.filter(
    (item) => item.nome.toLowerCase().includes(termo) || extra(item).toLowerCase().includes(termo),
  );
}
