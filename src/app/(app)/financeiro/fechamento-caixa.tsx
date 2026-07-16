"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso, dataLocalDoTimestamptz, hojeIso } from "@/lib/datas";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import {
  limitesPeriodo,
  deslocarPeriodo,
  periodoAnterior,
  pedidosNoPeriodo,
  faturamentoTotal,
  quebraPorFormaPagamento,
  topProdutos,
  variacaoPercentual,
  dentroDoPeriodo,
} from "@/lib/relatorios";
import type { PedidoRelatorio, TipoPeriodo } from "@/lib/relatorios";
import type { ContaPagar, ContaReceberFinanceiro } from "@/lib/types";

const TIPOS: readonly [TipoPeriodo, string][] = [
  ["dia", "Diário"],
  ["semana", "Semanal"],
  ["mes", "Mensal"],
];

export function FechamentoCaixa({
  pedidos,
  contasReceber,
  contasPagar,
}: {
  pedidos: PedidoRelatorio[];
  contasReceber: ContaReceberFinanceiro[];
  contasPagar: ContaPagar[];
}) {
  const [tipo, setTipo] = useState<TipoPeriodo>("dia");
  const [referencia, setReferencia] = useState(hojeIso());

  const { inicio, fim } = useMemo(() => limitesPeriodo(tipo, referencia), [tipo, referencia]);
  const anterior = useMemo(() => periodoAnterior(tipo, referencia), [tipo, referencia]);

  const pedidosPeriodo = useMemo(() => pedidosNoPeriodo(pedidos, inicio, fim), [pedidos, inicio, fim]);
  const pedidosAnteriorPeriodo = useMemo(
    () => pedidosNoPeriodo(pedidos, anterior.inicio, anterior.fim),
    [pedidos, anterior],
  );

  const faturamento = faturamentoTotal(pedidosPeriodo);
  const faturamentoAnterior = faturamentoTotal(pedidosAnteriorPeriodo);
  const variacao = variacaoPercentual(faturamento, faturamentoAnterior);

  const quebra = quebraPorFormaPagamento(pedidosPeriodo);
  const top = topProdutos(pedidosPeriodo);
  const vendasPeriodo = useMemo(
    () =>
      pedidosPeriodo
        .filter((p) => p.status === "faturado")
        .sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0)),
    [pedidosPeriodo],
  );

  const idsPedidosPeriodo = useMemo(() => new Set(pedidosPeriodo.map((p) => p.id)), [pedidosPeriodo]);
  const contasReceberDoPeriodo = useMemo(
    () => contasReceber.filter((c) => c.pedido_id && idsPedidosPeriodo.has(c.pedido_id)),
    [contasReceber, idsPedidosPeriodo],
  );
  const receberAberto = contasReceberDoPeriodo
    .filter((c) => c.situacao !== "pago")
    .reduce((s, c) => s + c.valor, 0);
  const receberJaPago = contasReceberDoPeriodo
    .filter((c) => c.situacao === "pago")
    .reduce((s, c) => s + c.valor, 0);

  const pagarBaixadoNoPeriodo = useMemo(
    () =>
      contasPagar
        .filter((c) => c.pago_em && dentroDoPeriodo(dataLocalDoTimestamptz(c.pago_em), inicio, fim))
        .reduce((s, c) => s + c.valor, 0),
    [contasPagar, inicio, fim],
  );

  function navegar(direcao: 1 | -1) {
    setReferencia((ref) => deslocarPeriodo(tipo, ref, direcao));
  }

  const rotuloPeriodo = inicio === fim ? formatarDataIso(inicio) : `${formatarDataIso(inicio)} – ${formatarDataIso(fim)}`;

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {TIPOS.map(([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => {
                setTipo(valor);
                setReferencia(hojeIso());
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                tipo === valor ? "border-rose bg-rose-soft text-rose-deep" : "border-line bg-surface text-text-soft"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navegar(-1)}
            aria-label="Período anterior"
            className="rounded-full border border-line px-3 py-1.5 text-sm text-ink"
          >
            ◀
          </button>
          <span className="text-sm font-semibold text-ink">{rotuloPeriodo}</span>
          <button
            onClick={() => navegar(1)}
            aria-label="Próximo período"
            className="rounded-full border border-line px-3 py-1.5 text-sm text-ink"
          >
            ▶
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Faturamento do período"
          valor={formatarMoeda(faturamento)}
          nota={
            variacao == null
              ? `${pedidosPeriodo.filter((p) => p.status === "faturado").length} pedido(s) faturado(s)`
              : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(0)}% vs. período anterior`
          }
          tom={variacao != null && variacao < 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Ainda a receber"
          valor={formatarMoeda(receberAberto)}
          nota={`${formatarMoeda(receberJaPago)} já recebido`}
          tom={receberAberto > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Contas a pagar baixadas"
          valor={formatarMoeda(pagarBaixadoNoPeriodo)}
          nota="pago no período"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line">
          <div className="border-b border-line px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink">Por forma de pagamento</h3>
          </div>
          <ul className="flex flex-col gap-2 p-4">
            {Object.entries(quebra).map(([forma, valor]) => (
              <li key={forma} className="flex items-center justify-between text-sm">
                <span className="text-text-soft">{FORMA_LABEL[forma] ?? forma}</span>
                <span className="font-semibold tabular-nums text-ink">{formatarMoeda(valor ?? 0)}</span>
              </li>
            ))}
            {Object.keys(quebra).length === 0 && (
              <li className="text-sm text-text-soft">Nenhuma venda faturada no período.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-line">
          <div className="border-b border-line px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink">Produtos mais vendidos</h3>
          </div>
          <ul className="flex flex-col gap-2 p-4">
            {top.map((p) => (
              <li key={p.nome} className="flex items-center justify-between text-sm">
                <span className="text-text-soft">
                  {p.nome} <span className="text-xs">({p.quantidade}x)</span>
                </span>
                <span className="font-semibold tabular-nums text-ink">{formatarMoeda(p.valor)}</span>
              </li>
            ))}
            {top.length === 0 && <li className="text-sm text-text-soft">Nenhuma venda faturada no período.</li>}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-line">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink">Vendas do período</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-4 py-2">Pedido</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Forma de pagamento</th>
              </tr>
            </thead>
            <tbody>
              {vendasPeriodo.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2.5">#{p.numero}</td>
                  <td className="px-4 py-2.5">{p.clientes?.nome ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatarMoeda(p.total)}</td>
                  <td className="px-4 py-2.5">{p.forma_pagamento ? FORMA_LABEL[p.forma_pagamento] : "—"}</td>
                </tr>
              ))}
              {vendasPeriodo.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-text-soft">
                    Nenhuma venda faturada no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
