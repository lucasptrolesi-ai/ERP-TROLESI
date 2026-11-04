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

// Dívida com o Atacado (varejo_dividas_atacado, origem venda -- venda_item_id
// preenchido): código do Atacado digitado/salvo na peça, por item vendido,
// vira dívida intercompany que o Varejo ainda deve pagar pro Atacado (ver
// a tela /varejo/financeiro, que já lista/baixa essas dívidas uma a uma --
// aqui é só o agregado pro relatório de vendas).
export type DividaAtacadoRelatorio = {
  codigo_atacado: number;
  quantidade: number;
  custo_total: number;
  status: string;
  venda_itens: { venda_id: string } | null;
};

/** Soma (codigo_atacado × quantidade) por venda -- mesma conta de "pontos"
 * do relatório de Atacado (pontosDoPedido em lib/relatorios.ts), só que a
 * origem aqui é a dívida intercompany gerada na venda, não um pedido_item. */
export function codigoAtacadoPorVenda(dividas: DividaAtacadoRelatorio[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const d of dividas) {
    const vendaId = d.venda_itens?.venda_id;
    if (!vendaId) continue;
    mapa.set(vendaId, (mapa.get(vendaId) ?? 0) + d.codigo_atacado * d.quantidade);
  }
  return mapa;
}

/** Saldo devedor corrente com o Atacado (R$) -- não é filtrado por período:
 * pagar uma dívida não está amarrado a quando a venda que a gerou aconteceu,
 * mesmo espírito do KPI "A pagar (intercompany)" do Painel Varejo. */
export function dividaAtacadoEmAberto(dividas: { status: string; custo_total: number }[]): number {
  return dividas.filter((d) => d.status === "em_aberto").reduce((s, d) => s + d.custo_total, 0);
}

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

export type ItemQuebraVarejo = { id: string; nome: string; vendas: number; faturamento: number; codigoAtacado: number };

type VendaParaQuebra = { id: string; status: string; total: number };

function agruparPorChave<V extends VendaParaQuebra>(
  vendas: V[],
  chaveDe: (v: V) => string | null | undefined,
  nomeDe: (v: V) => string,
  codigoPorVenda: Map<string, number>,
): ItemQuebraVarejo[] {
  const porChave = new Map<string, ItemQuebraVarejo>();
  for (const v of vendas) {
    if (v.status !== "concluida") continue;
    const chave = chaveDe(v);
    if (!chave) continue;
    const atual = porChave.get(chave) ?? { id: chave, nome: nomeDe(v), vendas: 0, faturamento: 0, codigoAtacado: 0 };
    atual.vendas += 1;
    atual.faturamento += v.total;
    atual.codigoAtacado += codigoPorVenda.get(v.id) ?? 0;
    porChave.set(chave, atual);
  }
  return Array.from(porChave.values()).sort((a, b) => b.faturamento - a.faturamento);
}

export function quebraVarejoPorCliente<V extends VendaParaQuebra & { cliente_id: string | null; clientes: { nome: string } | null }>(
  vendas: V[],
  codigoPorVenda: Map<string, number> = new Map(),
): ItemQuebraVarejo[] {
  return agruparPorChave(vendas, (v) => v.cliente_id, (v) => v.clientes?.nome ?? "Cliente", codigoPorVenda);
}

export function quebraVarejoPorVendedor<V extends VendaParaQuebra & { operador_id: string }>(
  vendas: V[],
  nomePorOperadorId: Map<string, string>,
  codigoPorVenda: Map<string, number> = new Map(),
): ItemQuebraVarejo[] {
  return agruparPorChave(vendas, (v) => v.operador_id, (v) => nomePorOperadorId.get(v.operador_id) ?? "—", codigoPorVenda);
}
