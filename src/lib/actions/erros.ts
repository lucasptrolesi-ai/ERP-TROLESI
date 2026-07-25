type ErroPostgres = { code?: string; message: string };

/** Traduz códigos de erro comuns do Postgres/PostgREST pra mensagem de negócio. */
export function mensagemErroSalvar(error: ErroPostgres, duplicado = "CPF/CNPJ"): string {
  if (error.code === "23505") {
    return `Já existe um cadastro com esse ${duplicado}.`;
  }
  return "Não foi possível salvar. Tente novamente.";
}

export function mensagemErroExcluir(error: ErroPostgres, vinculo = "pedidos ou contas"): string {
  if (error.code === "23503") {
    return `Não é possível excluir: há ${vinculo} vinculados a este cadastro. Desative-o em vez de excluir.`;
  }
  return "Não foi possível excluir. Tente novamente.";
}

/**
 * Cadastro em caixa alta (pedido direto do usuário, 2026-07-25) — mesma
 * convenção que os dados reais do GMax já seguem (nome, endereço, produto
 * sempre em maiúsculo). Opt-in (`caixaAlta: true`), não o padrão — a maioria
 * dos campos que passam por esta função são texto livre e devem virar
 * maiúsculo, mas um punhado é valor de enum/código que precisa bater
 * exatamente com uma constante do banco (ex: `garantia_tipo`) ou não faz
 * sentido maiusculizar (e-mail, URL, id) — nesses o chamador simplesmente
 * não passa a opção, preservando o valor como veio.
 */
export function normalizarCampo(
  valor: FormDataEntryValue | null,
  opcoes?: { caixaAlta?: boolean },
): string | null {
  const texto = String(valor ?? "").trim();
  if (texto.length === 0) return null;
  return opcoes?.caixaAlta ? texto.toUpperCase() : texto;
}
