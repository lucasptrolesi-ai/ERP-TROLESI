/** Formato devolvido pelas 3 functions de dashboard (etapa "dashboards_atacado_varejo_consolidado"):
 * relatorio_atacado_dashboard, relatorio_varejo_dashboard e relatorio_consolidado_mensal. */

export type FormaPagamentoResumo = { forma: string; total: number; qtd: number };
export type ProdutoResumo = { nome: string; total: number; quantidade: number };

export type RelatorioAtacadoDashboard = {
  faturamento_mensal: { mes: string; total: number; pedidos: number }[];
  formas_pagamento: FormaPagamentoResumo[];
  top_produtos: ProdutoResumo[];
  receber_aberto: number;
  pagar_aberto: number;
};

export type RelatorioVarejoDashboard = {
  faturamento_diario: { dia: string; total: number; vendas: number }[];
  formas_pagamento: FormaPagamentoResumo[];
  top_produtos: ProdutoResumo[];
  receber_aberto: number;
  pagar_aberto: number;
  sessoes_periodo: number;
  divergencia_total: number;
};

export type RelatorioConsolidadoMensal = {
  meses: { mes: string; atacado: number; varejo: number }[];
};

export type RelatorioConsolidadoPeriodo = {
  periodo: { inicio: string; fim: string };
  operacoes: { codigo: string; receita: number; a_receber: number; a_pagar: number; a_receber_intercompany: number; a_pagar_intercompany: number }[];
  consolidado: {
    receita: number;
    a_receber: number;
    a_pagar: number;
    intercompany_eliminado_a_receber: number;
    intercompany_eliminado_a_pagar: number;
  };
};

export const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Débito",
  cartao_debito: "Débito",
  credito: "Crédito",
  cartao_credito: "Crédito",
  promissoria: "Promissória",
  misto: "Misto",
};

export function rotuloFormaPagamento(forma: string): string {
  return FORMA_PAGAMENTO_LABEL[forma] ?? forma.charAt(0).toUpperCase() + forma.slice(1);
}

/** "2026-05" -> "mai/26" */
export function rotuloMesAno(mesIso: string): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(ano, mes - 1, 1));
}
