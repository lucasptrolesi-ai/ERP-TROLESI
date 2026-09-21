// Autorização por rota — FALHA POR PADRÃO (regra 2 do módulo de varejo).
//
// Toda rota autenticada precisa estar declarada em REGRAS_ROTAS; rota sem declaração é negada.
// Cada regra diz em qual operação a rota existe e, opcionalmente, quais papéis a acessam.
//
// Esta camada barra a navegação (proxy.ts) e mantém o menu coerente. Ela NUNCA é a única defesa:
// a autoridade sobre os dados é o banco (RLS restritiva por operação, triggers e guardas nas
// functions). Server Actions são POSTs para a rota da página, então herdam o filtro da rota, mas
// uma action pode ser chamada de outra página — por isso o banco também valida a operação.

export type RegraRota = {
  /** Prefixo do caminho: casa o caminho exato ou qualquer subcaminho. */
  prefixo: string;
  /** Casa só o caminho exato (usado pela raiz "/"). */
  exato?: boolean;
  /** Código da operação onde a rota existe, ou "qualquer". */
  operacao: string;
  /** Papéis permitidos. Ausente = qualquer papel com perfil. */
  papeis?: readonly string[];
};

export type ContextoAcesso = {
  papel: string | null;
  operacaoCodigo: string | null;
  operacoes: readonly { codigo: string; ativa: boolean }[];
};

export type MotivoNegacao = "sem_declaracao" | "sem_contexto" | "sem_operacao" | "papel" | "operacao_errada";

export type DecisaoAcesso =
  | { permitido: true }
  | { permitido: false; motivo: MotivoNegacao; operacaoNecessaria?: string; podeTrocar?: boolean };

/** Rotas acessíveis sem login (o proxy só as deixa passar quando NÃO há sessão). */
export const ROTAS_PUBLICAS = ["/login", "/esqueci-senha", "/redefinir-senha"] as const;

export const REGRAS_ROTAS: readonly RegraRota[] = [
  // Independem da operação.
  { prefixo: "/", exato: true, operacao: "qualquer" }, // a raiz redireciona conforme a operação
  { prefixo: "/conta", operacao: "qualquer" },
  { prefixo: "/camera", operacao: "qualquer" }, // pareamento por QR: foto do celular
  { prefixo: "/cotacao", operacao: "qualquer" }, // cotação de metal é dado de mercado, global
  { prefixo: "/permissoes", operacao: "qualquer", papeis: ["admin"] },

  // Módulo de atacado.
  { prefixo: "/pedidos", operacao: "ATACADO" },
  { prefixo: "/cadastros", operacao: "ATACADO" },
  { prefixo: "/estoque", operacao: "ATACADO" },
  { prefixo: "/financeiro", operacao: "ATACADO" },
  { prefixo: "/abatimentos", operacao: "ATACADO" },
  { prefixo: "/garantias", operacao: "ATACADO" },
  { prefixo: "/crediario", operacao: "ATACADO" },
  { prefixo: "/comissoes", operacao: "ATACADO" },
  { prefixo: "/frete", operacao: "ATACADO" },
  { prefixo: "/fiscal", operacao: "ATACADO" },
  { prefixo: "/relatorios", operacao: "ATACADO", papeis: ["admin"] },
  { prefixo: "/gmax", operacao: "ATACADO", papeis: ["admin"] },

  // Transferência atacado -> varejo: só o admin, no contexto do atacado.
  { prefixo: "/transferencia", operacao: "ATACADO", papeis: ["admin"] },

  // Varejo: caixa, PDV, catálogo e supervisores (o PDV Eventos é o módulo anterior do VAREJO).
  { prefixo: "/pdv-eventos", operacao: "VAREJO" },
  { prefixo: "/varejo", operacao: "VAREJO" },
  { prefixo: "/varejo/catalogo", operacao: "VAREJO", papeis: ["admin", "estoque"] },
  { prefixo: "/varejo/supervisores", operacao: "VAREJO", papeis: ["admin"] },
];

function normalizar(caminho: string): string {
  const semQuery = caminho.split("?")[0].split("#")[0];
  const semBarraFinal = semQuery.length > 1 ? semQuery.replace(/\/+$/, "") : semQuery;
  return semBarraFinal || "/";
}

/** Regra mais específica (maior prefixo) que casa o caminho, ou null se não houver declaração. */
export function encontrarRegra(caminho: string): RegraRota | null {
  const c = normalizar(caminho);
  let melhor: RegraRota | null = null;
  for (const regra of REGRAS_ROTAS) {
    const casa = regra.exato ? c === regra.prefixo : c === regra.prefixo || c.startsWith(regra.prefixo + "/");
    if (casa && (!melhor || regra.prefixo.length > melhor.prefixo.length)) melhor = regra;
  }
  return melhor;
}

export function decidirAcesso(caminho: string, contexto: ContextoAcesso | null): DecisaoAcesso {
  if (!contexto) return { permitido: false, motivo: "sem_contexto" };

  const regra = encontrarRegra(caminho);
  if (!regra) return { permitido: false, motivo: "sem_declaracao" };

  if (!contexto.papel) return { permitido: false, motivo: "papel" };
  if (regra.papeis && !regra.papeis.includes(contexto.papel)) return { permitido: false, motivo: "papel" };

  if (regra.operacao !== "qualquer") {
    if (!contexto.operacaoCodigo) return { permitido: false, motivo: "sem_operacao" };
    if (contexto.operacaoCodigo !== regra.operacao) {
      return {
        permitido: false,
        motivo: "operacao_errada",
        operacaoNecessaria: regra.operacao,
        podeTrocar: contexto.operacoes.some((o) => o.codigo === regra.operacao),
      };
    }
  }
  return { permitido: true };
}

/** Tela inicial de cada operação (a raiz "/" redireciona para cá). */
export function destinoInicial(operacaoCodigo: string | null): string {
  return operacaoCodigo === "VAREJO" ? "/varejo/pdv" : "/pedidos";
}
