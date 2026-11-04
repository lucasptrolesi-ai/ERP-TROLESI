"use client";

import { useMemo, useState } from "react";
import { GraficoMovimentoVendas } from "@/components/grafico-movimento-vendas";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { dataLocalDoTimestamptz, formatarDataIso, hojeIso } from "@/lib/datas";
import {
  deslocarPeriodo,
  dentroDoPeriodo,
  limitesPeriodo,
  periodoAnterior,
  variacaoPercentual,
  type TipoPeriodo,
} from "@/lib/relatorios";
import {
  codigoAtacadoPorVenda,
  dividaAtacadoEmAberto,
  faturamentoVarejoTotal,
  movimentoVarejoDiario,
  quebraVarejoPorCliente,
  quebraVarejoPorFormaPagamento,
  quebraVarejoPorVendedor,
  vendasNoPeriodo,
  type DividaAtacadoRelatorio,
  type ItemQuebraVarejo,
  type PagamentoRelatorio,
  type VendaRelatorio,
} from "@/lib/relatorios-varejo";

type Perfil = { id: string; nome: string };
type PagamentoComVenda = PagamentoRelatorio & { vendas: { criada_em: string; status: string } };

const PERIODOS: { valor: TipoPeriodo; rotulo: string }[] = [
  { valor: "dia", rotulo: "Diário" },
  { valor: "semana", rotulo: "Semanal" },
  { valor: "mes", rotulo: "Mensal" },
];

const FORMA_LABEL_VAREJO: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  debito: "Débito",
  credito: "Crédito",
};

function formatarCodigo(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export function RelatoriosVarejoView({
  vendas,
  pagamentos,
  perfis,
  dividasPeriodo,
  dividasEmAberto,
}: {
  vendas: VendaRelatorio[];
  pagamentos: PagamentoComVenda[];
  perfis: Perfil[];
  dividasPeriodo: DividaAtacadoRelatorio[];
  dividasEmAberto: { status: string; custo_total: number }[];
}) {
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>("mes");
  const [referencia, setReferencia] = useState(hojeIso());

  const { inicio, fim } = limitesPeriodo(tipoPeriodo, referencia);
  const anterior = periodoAnterior(tipoPeriodo, referencia);

  const vendasPeriodo = useMemo(() => vendasNoPeriodo(vendas, inicio, fim), [vendas, inicio, fim]);
  const vendasAnterior = useMemo(() => vendasNoPeriodo(vendas, anterior.inicio, anterior.fim), [vendas, anterior]);

  const movimentoPeriodo = useMemo(() => movimentoVarejoDiario(vendasPeriodo, inicio, fim), [vendasPeriodo, inicio, fim]);

  const faturamento = faturamentoVarejoTotal(vendasPeriodo);
  const faturamentoAnterior = faturamentoVarejoTotal(vendasAnterior);
  const variacao = variacaoPercentual(faturamento, faturamentoAnterior);

  const vendasConcluidas = useMemo(() => vendasPeriodo.filter((v) => v.status === "concluida"), [vendasPeriodo]);
  const cancelamentos = vendasPeriodo.filter((v) => v.status === "cancelada").length;
  const ticketMedio = vendasConcluidas.length > 0 ? faturamento / vendasConcluidas.length : 0;

  const pagamentosPeriodo = useMemo(
    () =>
      pagamentos.filter(
        (p) => p.vendas.status === "concluida" && dentroDoPeriodo(dataLocalDoTimestamptz(p.vendas.criada_em), inicio, fim),
      ),
    [pagamentos, inicio, fim],
  );
  const quebraForma = quebraVarejoPorFormaPagamento(pagamentosPeriodo);

  const nomePorOperadorId = useMemo(() => new Map(perfis.map((p) => [p.id, p.nome])), [perfis]);

  // Código do Atacado: mapa venda_id -> código×quantidade vem de TODAS as dívidas carregadas
  // (até 13 meses atrás), depois filtrado pro período junto com a venda — mesmo critério das
  // outras somas desta tela.
  const codigoPorVendaTotal = useMemo(() => codigoAtacadoPorVenda(dividasPeriodo), [dividasPeriodo]);
  const codigoAtacadoTotal = vendasConcluidas.reduce((s, v) => s + (codigoPorVendaTotal.get(v.id) ?? 0), 0);
  const dividaEmAberto = dividaAtacadoEmAberto(dividasEmAberto);

  const quebraClientes = useMemo(
    () => quebraVarejoPorCliente(vendasPeriodo, codigoPorVendaTotal),
    [vendasPeriodo, codigoPorVendaTotal],
  );
  const quebraVendedores = useMemo(
    () => quebraVarejoPorVendedor(vendasPeriodo, nomePorOperadorId, codigoPorVendaTotal),
    [vendasPeriodo, nomePorOperadorId, codigoPorVendaTotal],
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Relatórios Varejo</h1>
        <p className="text-sm text-text-soft">Vendas do PDV Varejo — separado do relatório de Atacado.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              onClick={() => setTipoPeriodo(p.valor)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
                tipoPeriodo === p.valor ? "border-rose bg-rose-soft text-rose-deep" : "border-line text-text-soft"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReferencia(deslocarPeriodo(tipoPeriodo, referencia, -1))}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-ink"
          >
            ◀
          </button>
          <span className="text-sm text-text-soft">{inicio === fim ? inicio : `${inicio} — ${fim}`}</span>
          <button
            onClick={() => setReferencia(deslocarPeriodo(tipoPeriodo, referencia, 1))}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-ink"
          >
            ▶
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Faturamento"
          valor={formatarMoeda(faturamento)}
          nota={variacao !== null ? `${variacao >= 0 ? "+" : ""}${variacao.toFixed(1)}% vs. período anterior` : "sem período anterior"}
        />
        <KpiCard label="Vendas" valor={String(vendasConcluidas.length)} nota="vendas concluídas" />
        <KpiCard label="Ticket médio" valor={formatarMoeda(ticketMedio)} nota="por venda" />
        <KpiCard label="Cancelamentos" valor={String(cancelamentos)} nota="vendas canceladas" tom={cancelamentos > 0 ? "warn" : "ok"} />
        <KpiCard label="Código Atacado" valor={formatarCodigo(codigoAtacadoTotal)} nota="soma dos códigos digitados/salvos" />
        <KpiCard
          label="Dívida com Atacado"
          valor={formatarMoeda(dividaEmAberto)}
          nota="só do que foi vendido, saldo total (não só do período)"
          tom={dividaEmAberto > 0 ? "warn" : "ok"}
        />
      </div>

      {movimentoPeriodo.length > 1 && <GraficoMovimentoVendas dados={movimentoPeriodo} />}

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">Quebra por forma de pagamento</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(quebraForma).map(([forma, valor]) => (
            <div key={forma} className="rounded-lg border border-line bg-cream p-3">
              <p className="text-xs text-text-soft">{FORMA_LABEL_VAREJO[forma] ?? forma}</p>
              <p className="font-display text-lg font-semibold text-rose-deep tabular-nums">{formatarMoeda(valor ?? 0)}</p>
            </div>
          ))}
          {Object.keys(quebraForma).length === 0 && (
            <p className="text-sm text-text-soft">Nenhuma venda concluída no período.</p>
          )}
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-ink">Vendas do período ({vendasConcluidas.length})</h2>
          <p className="text-xs font-semibold text-text-soft">
            {formatarMoeda(faturamento)} · código {formatarCodigo(codigoAtacadoTotal)}
          </p>
        </div>
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Data</th>
                <th className="px-5 py-2">Venda</th>
                <th className="px-5 py-2">Cliente</th>
                <th className="px-5 py-2">Vendedor</th>
                <th className="px-5 py-2">Valor</th>
                <th className="px-5 py-2">Código Atacado</th>
              </tr>
            </thead>
            <tbody>
              {vendasConcluidas.map((v) => {
                const codigo = codigoPorVendaTotal.get(v.id) ?? 0;
                return (
                  <tr key={v.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-5 py-2.5">{formatarDataIso(v.criada_em)}</td>
                    <td className="px-5 py-2.5 tabular-nums">#{v.numero}</td>
                    <td className="px-5 py-2.5">{v.clientes?.nome ?? "—"}</td>
                    <td className="px-5 py-2.5">{nomePorOperadorId.get(v.operador_id) ?? "—"}</td>
                    <td className="px-5 py-2.5 tabular-nums font-semibold text-rose-deep">{formatarMoeda(v.total)}</td>
                    <td className="px-5 py-2.5 tabular-nums">{codigo > 0 ? formatarCodigo(codigo) : "—"}</td>
                  </tr>
                );
              })}
              {vendasConcluidas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhuma venda concluída no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TabelaQuebraVarejo titulo="Faturamento por cliente" itens={quebraClientes} />
        <TabelaQuebraVarejo titulo="Faturamento por vendedor" itens={quebraVendedores} />
      </div>
    </div>
  );
}

const LIMITE_QUEBRA = 20;

function TabelaQuebraVarejo({ titulo, itens }: { titulo: string; itens: ItemQuebraVarejo[] }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="font-display text-base font-semibold text-ink">{titulo}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
              <th className="px-5 py-2">Nome</th>
              <th className="px-5 py-2">Vendas</th>
              <th className="px-5 py-2">Faturamento</th>
              <th className="px-5 py-2">Código Atacado</th>
            </tr>
          </thead>
          <tbody>
            {itens.slice(0, LIMITE_QUEBRA).map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-5 py-2.5">{i.nome}</td>
                <td className="px-5 py-2.5 tabular-nums">{i.vendas}</td>
                <td className="px-5 py-2.5 tabular-nums font-semibold text-rose-deep">{formatarMoeda(i.faturamento)}</td>
                <td className="px-5 py-2.5 tabular-nums">{i.codigoAtacado > 0 ? formatarCodigo(i.codigoAtacado) : "—"}</td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-text-soft">
                  Nenhuma venda concluída no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {itens.length > LIMITE_QUEBRA && (
        <p className="border-t border-line px-5 py-2 text-xs text-text-soft">e mais {itens.length - LIMITE_QUEBRA}...</p>
      )}
    </div>
  );
}
