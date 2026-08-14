"use client";

import { useMemo } from "react";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL_EVENTO, FORMAS_PAGAMENTO_EVENTO } from "@/lib/forma-pagamento-evento";
import type { VendaEvento } from "@/lib/types";

export function ResumoEvento({ vendasEvento }: { vendasEvento: VendaEvento[] }) {
  const resumo = useMemo(() => {
    const totalVendido = vendasEvento.reduce((s, v) => s + v.total, 0);
    const pecasVendidas = vendasEvento.reduce(
      (s, v) => s + v.vendas_evento_itens.reduce((s2, i) => s2 + i.quantidade, 0),
      0,
    );
    const porFormaPagamento = FORMAS_PAGAMENTO_EVENTO.map((forma) => ({
      forma,
      total: vendasEvento.filter((v) => v.forma_pagamento === forma).reduce((s, v) => s + v.total, 0),
    }));
    const maiorValor = Math.max(1, ...porFormaPagamento.map((f) => f.total));
    return { totalVendido, pecasVendidas, vendas: vendasEvento.length, porFormaPagamento, maiorValor };
  }, [vendasEvento]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Total vendido" valor={formatarMoeda(resumo.totalVendido)} nota={`${resumo.vendas} venda(s)`} />
        <KpiCard label="Peças vendidas" valor={String(resumo.pecasVendidas)} nota="unidades no total" />
        <KpiCard label="Ticket médio" valor={formatarMoeda(resumo.vendas > 0 ? resumo.totalVendido / resumo.vendas : 0)} nota="por venda" />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-base font-semibold text-ink">Por forma de pagamento</h2>
        <div className="mt-3 flex flex-col gap-2.5">
          {resumo.porFormaPagamento.map(({ forma, total }) => (
            <div key={forma} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-sm font-semibold text-ink">{FORMA_LABEL_EVENTO[forma]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-rose-soft">
                <div
                  className="h-full rounded-full bg-rose-deep"
                  style={{ width: `${(total / resumo.maiorValor) * 100}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-ink">
                {formatarMoeda(total)}
              </span>
            </div>
          ))}
        </div>
        {resumo.vendas === 0 && <p className="mt-2 text-sm text-text-soft">Nenhuma venda registrada ainda.</p>}
      </div>
    </div>
  );
}
