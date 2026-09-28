// Conversão entre o texto livre digitado no formulário ("tamanho 16, cor ouro") e o jsonb gravado
// em catalogo_variacoes.atributos ({"tamanho":"16","cor":"ouro"}) — usado tanto no cadastro (server
// action, varejo.ts) quanto na edição (formulário client, precisa reconstruir o texto original a
// partir do jsonb salvo).

/** "tamanho 16, cor ouro" -> {"tamanho":"16","cor":"ouro"}; texto sem chave vira {"variacao": texto}. */
export function parseAtributos(texto: string): Record<string, string> {
  const atributos: Record<string, string> = {};
  for (const parte of texto.split(",")) {
    const t = parte.trim();
    if (t === "") continue;
    const espaco = t.indexOf(" ");
    if (espaco > 0) atributos[t.slice(0, espaco).toLowerCase()] = t.slice(espaco + 1).trim();
    else atributos.variacao = t;
  }
  return atributos;
}

/** Inverso de parseAtributos — pré-preenche o campo de texto ao abrir uma peça pra editar. */
export function formatarAtributos(atributos: Record<string, string> | null | undefined): string {
  if (!atributos) return "";
  return Object.entries(atributos)
    .map(([chave, valor]) => (chave === "variacao" ? valor : `${chave} ${valor}`))
    .join(", ");
}
