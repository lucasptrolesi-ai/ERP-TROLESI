// Contexto da sessão devolvido pela function `contexto_sessao()` do banco (etapa 2).
// A operação vem do banco, validada contra `usuario_operacoes` — nunca de parâmetro do cliente.

export type OperacaoDoUsuario = {
  id: string;
  codigo: string;
  nome: string;
  ativa: boolean;
  padrao: boolean;
};

export type ContextoSessao = {
  usuario_id: string;
  papel: string | null;
  operacao_id: string | null;
  operacao_codigo: string | null;
  operacoes: OperacaoDoUsuario[];
  /** Permissões especiais concedidas ao usuário na operação atual. */
  permissoes: string[];
  /** true só para o login do Lucas (ver public.sou_dono() no banco) — acesso total, sem as travas
   * normais de papel/operação/PIN. Amarrado ao id da conta, não ao papel "admin" em geral. */
  dono: boolean;
};
