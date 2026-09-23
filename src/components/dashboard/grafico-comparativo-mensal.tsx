"use client";

import { useState } from "react";
import { formatarMoeda, formatarMoedaCompacta } from "@/lib/formatar-moeda";
import { rotuloMesAno } from "@/lib/dashboard-tipos";

/** Barras pareadas (atacado x varejo) por mês — painel Consolidado. Mesmo
 * padrão acessível dos outros gráficos do dashboard (hover/foco, aria-label,
 * tabela equivalente no fim pra quem não usa mouse). */
export function GraficoComparativoMensal({ dados }: { dados: { mes: string; atacado: number; varejo: number }[] }) {
  const [ativo, setAtivo] = useState<{ i: number; serie: "atacado" | "varejo" } | null>(null);

  const maximo = Math.max(1, ...dados.map((d) => Math.max(d.atacado, d.varejo)));
  const semDado = dados.every((d) => d.atacado === 0 && d.varejo === 0);

  if (semDado) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-1 font-display text-base font-semibold text-ink">Atacado x Varejo, por mês</h2>
        <p className="text-sm text-text-soft">Nenhum faturamento registrado no período.</p>
      </div>
    );
  }

  const barra = (valor: number, serie: "atacado" | "varejo", i: number) => {
    const alturaPct = valor > 0 ? Math.max((valor / maximo) * 100, 3) : 0;
    const estaAtivo = ativo?.i === i && ativo.serie === serie;
    return (
      <button
        type="button"
        onMouseEnter={() => setAtivo({ i, serie })}
        onMouseLeave={() => setAtivo(null)}
        onFocus={() => setAtivo({ i, serie })}
        onBlur={() => setAtivo(null)}
        aria-label={`${serie === "atacado" ? "Atacado" : "Varejo"}, ${rotuloMesAno(dados[i].mes)}: ${formatarMoeda(valor)}`}
        className="flex h-full flex-1 items-end"
      >
        <span
          style={{ height: `${alturaPct}%` }}
          className={`w-full rounded-t-[3px] transition-colors ${
            serie === "atacado" ? (estaAtivo ? "bg-gold-end" : "bg-rose-deep") : estaAtivo ? "bg-text-soft" : "bg-ink"
          }`}
        />
      </button>
    );
  };

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">Atacado x Varejo, por mês</h2>
        <div className="flex items-center gap-3 text-xs text-text-soft">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-rose-deep" /> Atacado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-ink" /> Varejo
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex h-40 flex-none flex-col justify-between py-0.5 text-right text-[10px] text-text-soft tabular-nums sm:h-48">
          <span>{formatarMoedaCompacta(maximo)}</span>
          <span>R$ 0</span>
        </div>
        <div className="flex h-40 flex-1 items-end gap-2 border-b border-line sm:h-48">
          {dados.map((d, i) => {
            const tooltipAtivo = ativo?.i === i;
            return (
              <div key={d.mes} className="relative flex h-full flex-1 items-end justify-center gap-0.5">
                {tooltipAtivo && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-md">
                    <p className="font-semibold text-rose-deep tabular-nums">Atacado {formatarMoeda(d.atacado)}</p>
                    <p className="font-semibold text-ink tabular-nums">Varejo {formatarMoeda(d.varejo)}</p>
                  </div>
                )}
                {barra(d.atacado, "atacado", i)}
                {barra(d.varejo, "varejo", i)}
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
