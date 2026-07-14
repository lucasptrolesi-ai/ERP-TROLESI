/**
 * Sem `supabase gen types` (decisão registrada em DECISIONS.md), o
 * supabase-js infere embeds many-to-one (ex: `clientes(nome)` numa tabela
 * cuja FK aponta pra `clientes`) como array só pelo texto do `.select()` —
 * em runtime cada linha vem com um objeto único, não uma lista. Usar só
 * pra isso, nunca pra esconder erro de digitação de coluna.
 */
export function comoLista<T>(data: unknown): T[] {
  return (data ?? []) as unknown as T[];
}
