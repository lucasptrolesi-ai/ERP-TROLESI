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

export function normalizarCampo(valor: FormDataEntryValue | null): string | null {
  const texto = String(valor ?? "").trim();
  return texto.length > 0 ? texto : null;
}
