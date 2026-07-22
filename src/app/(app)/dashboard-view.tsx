"use client";

import { useMemo } from "react";
import { KpiCard } from "@/components/kpi-card";
import { AlertaMetaFaturamento } from "@/components/alerta-meta-faturamento";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso, hojeIso, dataLocalDoTimestamptz } from "@/lib/datas";
import { situacaoEfetiva } from "@/lib/situacao-conta";
import { limitesPeriodo, pedidosNoPeriodo, faturamentoTotal, type PedidoRelatorio } from "@/lib/relatorios";
import { STATUS_LABEL } from "@/lib/status-pedido";
import type { ContaReceberFinanceiro, Produto } from "@/lib/types";

const META_FATURAMENTO_MENSAL = 55000;

export type PedidoDashboard = PedidoRelatorio;

export function DashboardView({
  nome,
  pedidos,
  contasReceber,
  produtos,
  podeVerFinanceiro,
}: {
  nome: string;
  pedidos: PedidoDashboard[];
  contasReceber: Pick<ContaReceberFinanceiro, "id" | "valor" | "vencimento" | "situacao">[];
  produtos: Pick<Produto, "nome" | "quantidade_estoque" | "estoque_minimo">[];
  podeVerFinanceiro: boolean;
}) {
  const hoje = hojeIso();

  const pedidosHoje = useMemo(
    () => pedidos.filter((p) => dataLocalDoTimestamptz(p.criado_em) === hoje),
    [pedidos, hoje],
  );
  const faturadosHoje = pedidosHoje.filter((p) => p.status === "faturado");
  const totalFaturadoHoje = faturadosHoje.reduce((s, p) => s + p.total, 0);
  const ticketMedioHoje = faturadosHoje.length > 0 ? totalFaturadoHoje / faturadosHoje.length : 0;

  const { inicio: inicioMes, fim: fimMes } = limitesPeriodo("mes", hoje);
  const pedidosDoMes = useMemo(() => pedidosNoPeriodo(pedidos, inicioMes, fimMes), [pedidos, inicioMes, fimMes]);
  const faturamentoMes = faturamentoTotal(pedidosDoMes);
  const progressoMeta = Math.min(100, (faturamentoMes / META_FATURAMENTO_MENSAL) * 100);
  const metaBatida = faturamentoMes >= META_FATURAMENTO_MENSAL;

  const emAtraso = useMemo(
    () => contasReceber.filter((c) => situacaoEfetiva(c.situacao, c.vencimento) === "atrasado"),
    [contasReceber],
  );
  const totalEmAtraso = emAtraso.reduce((s, c) => s + c.valor, 0);

  const produtosBaixo = useMemo(
    () =>
      produtos
        .filter((p) => p.quantidade_estoque < p.estoque_minimo)
        .sort((a, b) => a.quantidade_estoque - b.quantidade_estoque),
    [produtos],
  );

  const pedidosRecentes = pedidos.slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Bem-vindo(a), {nome}</h1>
        <p className="text-sm text-text-soft">Visão geral de hoje, {formatarDataIso(hoje)}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pedidos hoje"
          valor={String(pedidosHoje.length)}
          nota={`${faturadosHoje.length} faturado(s)`}
        />
        <KpiCard
          label="Ticket médio hoje"
          valor={formatarMoeda(ticketMedioHoje)}
          nota={faturadosHoje.length > 0 ? `${faturadosHoje.length} venda(s) faturada(s)` : "nenhuma venda faturada ainda"}
        />
        {podeVerFinanceiro ? (
          <KpiCard
            label="A receber em atraso"
            valor={formatarMoeda(totalEmAtraso)}
            nota={`${emAtraso.length} parcela(s) vencida(s)`}
            tom={emAtraso.length > 0 ? "crit" : "ok"}
          />
        ) : (
          <KpiCard label="Produtos ativos" valor={String(produtos.length)} nota="no catálogo" />
        )}
        <KpiCard
          label="Estoque baixo"
          valor={String(produtosBaixo.length)}
          nota="produtos abaixo do mínimo"
          tom={produtosBaixo.length > 0 ? "warn" : "ok"}
        />
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">Faturamento do mês</p>
          <span className={`text-xs font-bold ${metaBatida ? "text-ok" : "text-text-soft"}`}>
            {metaBatida ? "🎉 Meta batida!" : `${progressoMeta.toFixed(0)}% da meta`}
          </span>
        </div>
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-rose-deep">
          {formatarMoeda(faturamentoMes)}{" "}
          <span className="text-sm font-normal text-text-soft">/ {formatarMoeda(META_FATURAMENTO_MENSAL)}</span>
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${metaBatida ? "bg-ok" : "bg-gradient-to-r from-gold-start to-gold-end"}`}
            style={{ width: `${progressoMeta}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold text-ink">Pedidos recentes</h2>
            <span className="text-xs text-text-soft">últimos 5</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                  <th className="px-4 py-2">Pedido</th>
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2">Itens</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {pedidosRecentes.map((p) => {
                  const status = STATUS_LABEL[p.status] ?? { rotulo: p.status, classe: "bg-line text-text-soft" };
                  return (
                    <tr key={p.id} className="border-t border-line">
                      <td className="px-4 py-2.5">#{p.numero}</td>
                      <td className="px-4 py-2.5">{p.clientes?.nome ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {p.pedido_itens.reduce((s, i) => s + i.quantidade, 0)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{formatarMoeda(p.total)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.classe}`}>
                          {status.rotulo}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {pedidosRecentes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-text-soft">
                      Nenhum pedido ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[14px] border border-line bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold text-ink">Estoque em alerta</h2>
            <span className="text-xs text-text-soft">mínimo configurado</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2">Qtd.</th>
                  <th className="px-4 py-2">Mín.</th>
                </tr>
              </thead>
              <tbody>
                {produtosBaixo.slice(0, 8).map((p, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2.5">{p.nome}</td>
                    <td className="px-4 py-2.5 tabular-nums text-crit">{p.quantidade_estoque}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p.estoque_minimo}</td>
                  </tr>
                ))}
                {produtosBaixo.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-text-soft">
                      Nenhum produto abaixo do mínimo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {podeVerFinanceiro && <AlertaMetaFaturamento faturamentoMes={faturamentoMes} meta={META_FATURAMENTO_MENSAL} />}
    </div>
  );
}
