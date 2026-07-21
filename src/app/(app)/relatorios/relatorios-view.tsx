"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import {
  deslocarPeriodo,
  dentroDoPeriodo,
  faturamentoTotal,
  limitesPeriodo,
  pedidosNoPeriodo,
  periodoAnterior,
  quebraPorFormaPagamento,
  variacaoPercentual,
  type PedidoRelatorio,
  type TipoPeriodo,
} from "@/lib/relatorios";
import { dataLocalDoTimestamptz, hojeIso } from "@/lib/datas";
import type { Abatimento, Garantia, Produto } from "@/lib/types";

const PERIODOS: { valor: TipoPeriodo; rotulo: string }[] = [
  { valor: "dia", rotulo: "Diário" },
  { valor: "semana", rotulo: "Semanal" },
  { valor: "mes", rotulo: "Mensal" },
];

export function RelatoriosView({
  pedidos,
  abatimentos,
  garantias,
  produtos,
}: {
  pedidos: PedidoRelatorio[];
  abatimentos: Abatimento[];
  garantias: Garantia[];
  produtos: Produto[];
}) {
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>("mes");
  const [referencia, setReferencia] = useState(hojeIso());

  const { inicio, fim } = limitesPeriodo(tipoPeriodo, referencia);
  const anterior = periodoAnterior(tipoPeriodo, referencia);

  const pedidosPeriodo = useMemo(() => pedidosNoPeriodo(pedidos, inicio, fim), [pedidos, inicio, fim]);
  const pedidosAnterior = useMemo(
    () => pedidosNoPeriodo(pedidos, anterior.inicio, anterior.fim),
    [pedidos, anterior],
  );

  const faturamento = faturamentoTotal(pedidosPeriodo);
  const faturamentoAnterior = faturamentoTotal(pedidosAnterior);
  const variacao = variacaoPercentual(faturamento, faturamentoAnterior);

  const vendasFaturadas = pedidosPeriodo.filter((p) => p.status === "faturado" || p.status === "aguardando_lancamento_gmax" || p.status === "lancado_gmax");
  const cancelamentos = pedidosPeriodo.filter((p) => p.status === "cancelado").length;
  const ticketMedio = vendasFaturadas.length > 0 ? faturamento / vendasFaturadas.length : 0;
  const quebraForma = quebraPorFormaPagamento(pedidosPeriodo);

  // criado_em é timestamptz (UTC) — comparar a string direto contra
  // "inicio"/"fim" (datas locais de Brasília) já causou esse exato bug de
  // fuso antes neste projeto (rollover perto da meia-noite). Sempre passar
  // pelo mesmo dentroDoPeriodo()/dataLocalDoTimestamptz() que pedidosNoPeriodo
  // já usa, nunca comparação de string crua.
  const abatimentosPeriodo = abatimentos.filter((a) => dentroDoPeriodo(dataLocalDoTimestamptz(a.criado_em), inicio, fim));
  const abatimentosAprovados = abatimentosPeriodo.filter((a) => a.status === "aprovado");
  const abatimentosReprovados = abatimentosPeriodo.filter((a) => a.status === "reprovado");
  const valorAbatido = abatimentosAprovados.reduce((s, a) => s + (a.valor_atribuido ?? 0), 0);

  const garantiasPeriodo = garantias.filter((g) => dentroDoPeriodo(dataLocalDoTimestamptz(g.criado_em), inicio, fim));
  const garantiasAprovadas = garantiasPeriodo.filter((g) => g.aprovado === true).length;
  const garantiasReprovadas = garantiasPeriodo.filter((g) => g.aprovado === false).length;

  const estoqueBaixo = produtos.filter((p) => p.quantidade_estoque < p.estoque_minimo);

  return (
    <div className="flex flex-col gap-5">
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
          <span className="text-sm text-text-soft">
            {inicio === fim ? inicio : `${inicio} — ${fim}`}
          </span>
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
        <KpiCard label="Vendas" valor={String(vendasFaturadas.length)} nota="pedidos faturados/registrados" />
        <KpiCard label="Ticket médio" valor={formatarMoeda(ticketMedio)} nota="por venda" />
        <KpiCard label="Cancelamentos" valor={String(cancelamentos)} nota="pedidos extornados" tom={cancelamentos > 0 ? "warn" : "ok"} />
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">Quebra por forma de pagamento</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(quebraForma).map(([forma, valor]) => (
            <div key={forma} className="rounded-lg border border-line bg-cream p-3">
              <p className="text-xs text-text-soft">{FORMA_LABEL[forma] ?? forma}</p>
              <p className="font-display text-lg font-semibold text-rose-deep tabular-nums">{formatarMoeda(valor ?? 0)}</p>
            </div>
          ))}
          {Object.keys(quebraForma).length === 0 && (
            <p className="text-sm text-text-soft">Nenhuma venda faturada no período.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-ink">Abatimentos</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-text-soft">Aprovados</p>
              <p className="font-display text-lg font-semibold text-ok">{abatimentosAprovados.length}</p>
            </div>
            <div>
              <p className="text-text-soft">Reprovados</p>
              <p className="font-display text-lg font-semibold text-crit">{abatimentosReprovados.length}</p>
            </div>
            <div>
              <p className="text-text-soft">Valor abatido</p>
              <p className="font-display text-lg font-semibold text-rose-deep tabular-nums">{formatarMoeda(valorAbatido)}</p>
            </div>
          </div>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-ink">Garantias</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-text-soft">Aprovadas</p>
              <p className="font-display text-lg font-semibold text-ok">{garantiasAprovadas}</p>
            </div>
            <div>
              <p className="text-text-soft">Reprovadas</p>
              <p className="font-display text-lg font-semibold text-crit">{garantiasReprovadas}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Estoque abaixo do mínimo ({estoqueBaixo.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {estoqueBaixo.slice(0, 20).map((p) => (
            <span key={p.id} className="rounded-full bg-warn-bg px-3 py-1 text-xs font-semibold text-warn">
              {p.nome} ({p.quantidade_estoque}/{p.estoque_minimo})
            </span>
          ))}
          {estoqueBaixo.length === 0 && <p className="text-sm text-text-soft">Nenhum produto abaixo do mínimo.</p>}
        </div>
      </div>

      <p className="text-center text-xs text-text-soft">
        Indicadores ainda pendentes (seção 24 do documento mestre): primeira compra, clientes reativados/inativos,
        crediários/atrasos, taxas de cartão, fretes grátis, comissões — próximos a construir.
      </p>
    </div>
  );
}
