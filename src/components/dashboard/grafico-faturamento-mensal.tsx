"use client";

import { useState } from "react";
import { formatarMoeda, formatarMoedaCompacta } from "@/lib/formatar-moeda";
import { rotuloMesAno } from "@/lib/dashboard-tipos";

/** Igual ao GraficoMovimentoVendas, mas com barras por mês em vez de por dia
 * (rótulo "mai/26" em vez de data completa) — usado no painel do Atacado. */
export function GraficoFaturamentoMensal({ dados }: { dados: { mes: string; total: number }[] }) {
  const [indiceAtivo, setIndiceAtivo] = useState<number | null>(null);

  const total = dados.reduce((s, d) => s + d.total, 0);
  const maximo = Math.max(1, ...dados.map((d) => d.total));

  if (total === 0) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-1 font-display text-base font-semibold text-ink">Faturamento por mês</h2>
        <p className="text-sm text-text-soft">Nenhum pedido faturado no período.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">Faturamento por mês</h2>
        <p className="text-xs text-text-soft">
          total <span className="font-semibold text-rose-deep tabular-nums">{formatarMoeda(total)}</span>
        </p>
      </div>

      <div className="flex gap-3">
        <div className="flex h-40 flex-none flex-col justify-between py-0.5 text-right text-[10px] text-text-soft tabular-nums sm:h-48">
          <span>{formatarMoedaCompacta(maximo)}</span>
          <span>R$ 0</span>
        </div>
        <div className="flex h-40 flex-1 items-end gap-2 border-b border-line sm:h-48">
          {dados.map((d, i) => {
            const alturaPct = d.total > 0 ? Math.max((d.total / maximo) * 100, 3) : 0;
            const ativo = indiceAtivo === i;
            return (
              <div key={d.mes} className="relative flex h-full flex-1 items-end justify-center">
                {ativo && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-md">
                    <p className="font-semibold text-ink tabular-nums">{formatarMoeda(d.total)}</p>
                    <p className="text-text-soft">{rotuloMesAno(d.mes)}</p>
                  </div>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setIndiceAtivo(i)}
                  onMouseLeave={() => setIndiceAtivo(null)}
                  onFocus={() => setIndiceAtivo(i)}
                  onBlur={() => setIndiceAtivo(null)}
                  aria-label={`${rotuloMesAno(d.mes)}: ${formatarMoeda(d.total)}`}
                  className="flex h-full w-full max-w-[46px] items-end"
                >
                  <span
                    style={{ height: `${alturaPct}%` }}
                    className={`w-full rounded-t-[4px] transition-colors ${ativo ? "bg-gold-end" : "bg-rose-deep"}`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-2 text-[10px] text-text-soft" style={{ paddingLeft: "calc(2.6rem)" }}>
        {dados.map((d) => (
          <span key={d.mes} className="flex-1 text-center">
            {rotuloMesAno(d.mes)}
          </span>
        ))}
      </div>
    </div>
  );
}
