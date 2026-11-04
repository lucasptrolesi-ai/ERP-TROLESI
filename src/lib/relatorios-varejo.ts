import { dataLocalDoTimestamptz } from "@/lib/datas";
import { dentroDoPeriodo } from "@/lib/relatorios";

// Espelha lib/relatorios.ts, mas pro módulo de Varejo: tabela `vendas` (não
// `pedidos`), status "concluida"/"cancelada" (não "faturado"/"cancelado"),
// campo `criada_em` (não `criado_em`) e sem o conceito de "pontos" (código
// da peça do Atacado) -- esse indicador só existe no pedido de atacado, o
// Varejo não tem equivalente. Duplicado em vez de generalizado: os dois
// módulos são operações diferentes, com modelos de dado próprios, e forçar
// um "status pronto" genérico nas funções de relatorios.ts arriscava
// regressão no relatório de Atacado só pra economizar algumas linhas aqui.

export type VendaRelatorio = {
  id: string;
  numero: number;
  status: string;
  total: number;
  criada_em: string;
  cliente_id: string | null;
  operador_id: string;
  clientes: { nome: string } | null;
};

export type PagamentoRelatorio = { forma: string; valor: number };

export function vendasNoPeriodo<T extends { criada_em: string }>(vendas: T[], inicio: string, fim: string): T[] {
  return vendas.filter((v) => dentroDoPeriodo(dataLocalDoTimestamptz(v.criada_em), inicio, fim));
}

export function faturamentoVarejoTotal(vendas: { status: string; total: number }[]): number {
  return vendas.filter((v) => v.status === "concluida").reduce((s, v) => s + v.total, 0);
}

/** Faturamento por dia dentro de [inicio, fim], um ponto por dia mesmo nos
 * dias sem venda -- mesmo raciocínio de movimentoDiario (lib/relatorios.ts),
 * duplicado aqui só pelo status "concluida" em vez de "faturado". */
export function movimentoVarejoDiario(
  vendas: { status: string; total: number; criada_em: string }[],
  inicio: string,
  fim: string,
): { data: string; valor: number }[] {
  const porDia = new Map<string, number>();
  for (const v of vendas) {
    if (v.status !== "concluida") continue;
    const dia = dataLocalDoTimestamptz(v.criada_em);
    porDia.set(dia, (porDia.get(dia) ?? 0) + v.total);
  }
  const dias: { data: string; valor: number }[] = [];
  for (let cursor = inicio; cursor <= fim; cursor = proximoDia(cursor)) {
    dias.push({ data: cursor, valor: porDia.get(cursor) ?? 0 });
  }
  return dias;
}

function proximoDia(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia, 12);
  data.setDate(data.getDate() + 1);
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function quebraVarejoPorFormaPagamento(pagamentos: PagamentoRelatorio[]): Partial<Record<string, number>> {
  const soma: Partial<Record<string, number>> = {};
  for (const p of pagamentos) {
    soma[p.forma] = (soma[p.forma] ?? 0) + p.valor;
  }
  return soma;
}

export type ItemQuebraVarejo = { id: string; nome: string; vendas: number; faturamento: number };

type VendaParaQuebra = { status: string; total: number };

function agruparPorChave<V extends VendaParaQuebra>(
  vendas: V[],
  chaveDe: (v: V) => string | null | undefined,
  nomeDe: (v: V) => string,
): ItemQuebraVarejo[] {
  const porChave = new Map<string, ItemQuebraVarejo>();
  for (const v of vendas) {
    if (v.status !== "concluida") continue;
    const chave = chaveDe(v);
    if (!chave) continue;
    const atual = porChave.get(chave) ?? { id: chave, nome: nomeDe(v), vendas: 0, faturamento: 0 };
    atual.vendas += 1;
    atual.faturamento += v.total;
    porChave.set(chave, atual);
  }
  return Array.from(porChave.values()).sort((a, b) => b.faturamento - a.faturamento);
}

export function quebraVarejoPorCliente<V extends VendaParaQuebra & { cliente_id: string | null; clientes: { nome: string } | null }>(
  vendas: V[],
): ItemQuebraVarejo[] {
  return agruparPorChave(vendas, (v) => v.cliente_id, (v) => v.clientes?.nome ?? "Cliente");
}

export function quebraVarejoPorVendedor<V extends VendaParaQuebra & { operador_id: string }>(
  vendas: V[],
  nomePorOperadorId: Map<string, string>,
): ItemQuebraVarejo[] {
  return agruparPorChave(vendas, (v) => v.operador_id, (v) => nomePorOperadorId.get(v.operador_id) ?? "—");
}
