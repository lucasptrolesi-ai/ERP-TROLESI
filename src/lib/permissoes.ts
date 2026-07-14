// Espelha os papéis liberados por escrita nas policies de RLS de cada
// tabela (ver supabase/README.md, matriz de acesso). Fonte única — se um
// papel mudar aqui, também precisa mudar na migration correspondente
// (e vice-versa), mas pelo menos fica num lugar só do lado do app.
export function podeEditarClientes(papel: string): boolean {
  return papel === "admin" || papel === "vendedor";
}

export function podeEditarFornecedores(papel: string): boolean {
  return papel === "admin" || papel === "financeiro";
}

export function podeEditarProdutos(papel: string): boolean {
  return papel === "admin" || papel === "estoque";
}

export function podeEditarPedidos(papel: string): boolean {
  return papel === "admin" || papel === "vendedor";
}
