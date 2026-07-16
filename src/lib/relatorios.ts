import { dataLocalDoTimestamptz } from "@/lib/datas";
import type { FormaPagamento } from "@/lib/types";

export type PedidoRelatorio = {
  id: string;
  numero: number;
  status: string;
  forma_pagamento: FormaPagamento | null;
  total: number;
  criado_em: string;
  clientes: { nome: string } | null;
  pedido_itens: { quantidade: number; preco_unitario: number; produto_id: string; produtos: { nome: string } | null }[];
};

export type TipoPeriodo = "dia" | "semana" | "mes";

function paraIsoSimples(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Constrói um Date "puro" (meio-dia local) a partir de uma data
 * "AAAA-MM-DD" — evita problema de fuso na aritmética de calendário
 * (soma/subtrai dias/meses), já que nunca troca de fuso no meio da conta. */
function paraDataLocal(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia, 12);
}

export function limitesPeriodo(tipo: TipoPeriodo, referencia: string): { inicio: string; fim: string } {
  const data = paraDataLocal(referencia);

  if (tipo === "dia") return { inicio: referencia, fim: referencia };

  if (tipo === "semana") {
    const diaSemana = data.getDay();
    const deslocamento = diaSemana === 0 ? 6 : diaSemana - 1;
    const inicio = new Date(data);
    inicio.setDate(inicio.getDate() - deslocamento);
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 6);
    return { inicio: paraIsoSimples(inicio), fim: paraIsoSimples(fim) };
  }

  const inicioMes = new Date(data.getFullYear(), data.getMonth(), 1);
  const fimMes = new Date(data.getFullYear(), data.getMonth() + 1, 0);
  return { inicio: paraIsoSimples(inicioMes), fim: paraIsoSimples(fimMes) };
}

/** Desloca a data de referência pro período anterior/seguinte do mesmo tipo. */
export function deslocarPeriodo(tipo: TipoPeriodo, referencia: string, direcao: 1 | -1): string {
  const data = paraDataLocal(referencia);
  if (tipo === "dia") {
    data.setDate(data.getDate() + direcao);
  } else if (tipo === "semana") {
    data.setDate(data.getDate() + direcao * 7);
  } else {
    // "mes": só ano+mês importam pro limitesPeriodo — fixa o dia em 1 antes
    // de somar, senão uma referência em 31/jan pulava fevereiro inteiro
    // (31/jan + 1 mês vira 3/mar, porque fevereiro não tem dia 31).
    data.setDate(1);
    data.setMonth(data.getMonth() + direcao);
  }
  return paraIsoSimples(data);
}

/** Período anterior de mesmo tamanho (dia/semana/mês anterior), pro
 * comparativo "essa semana vs. semana passada". */
export function periodoAnterior(tipo: TipoPeriodo, referencia: string): { inicio: string; fim: string } {
  return limitesPeriodo(tipo, deslocarPeriodo(tipo, referencia, -1));
}

export function dentroDoPeriodo(dataIso: string, inicio: string, fim: string): boolean {
  return dataIso >= inicio && dataIso <= fim;
}

export function pedidosNoPeriodo<T extends { criado_em: string }>(pedidos: T[], inicio: string, fim: string): T[] {
  return pedidos.filter((p) => dentroDoPeriodo(dataLocalDoTimestamptz(p.criado_em), inicio, fim));
}

export function faturamentoTotal(pedidos: { status: string; total: number }[]): number {
  return pedidos.filter((p) => p.status === "faturado").reduce((s, p) => s + p.total, 0);
}

export function quebraPorFormaPagamento(
  pedidos: { status: string; forma_pagamento: FormaPagamento | null; total: number }[],
): Partial<Record<FormaPagamento, number>> {
  const soma: Partial<Record<FormaPagamento, number>> = {};
  for (const p of pedidos) {
    if (p.status !== "faturado" || !p.forma_pagamento) continue;
    soma[p.forma_pagamento] = (soma[p.forma_pagamento] ?? 0) + p.total;
  }
  return soma;
}

export function topProdutos(
  pedidos: PedidoRelatorio[],
  limite = 8,
): { nome: string; quantidade: number; valor: number }[] {
  const porProduto = new Map<string, { nome: string; quantidade: number; valor: number }>();
  for (const p of pedidos) {
    if (p.status !== "faturado") continue;
    for (const item of p.pedido_itens) {
      const nome = item.produtos?.nome ?? "Produto";
      const chave = item.produto_id || nome;
      const atual = porProduto.get(chave) ?? { nome, quantidade: 0, valor: 0 };
      atual.quantidade += item.quantidade;
      atual.valor += item.quantidade * item.preco_unitario;
      porProduto.set(chave, atual);
    }
  }
  return Array.from(porProduto.values())
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limite);
}

/** % de variação entre o valor atual e o anterior — null quando não dá pra
 * calcular variação percentual de verdade (anterior zerado). */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}
