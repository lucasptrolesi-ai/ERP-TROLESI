"use client";

import { useState } from "react";
import { formatarDataIso } from "@/lib/datas";
import { formatarMoeda, formatarMoedaCompacta } from "@/lib/formatar-moeda";

/** Gráfico de barras do faturamento diário — série única (não precisa de
 * legenda: o título já diz o que é), com tooltip por barra igual no hover e
 * no foco por teclado, e uma tabela equivalente pra quem não usa mouse ou
 * lê por leitor de tela. */
export function GraficoMovimentoVendas({ dados }: { dados: { data: string; valor: number }[] }) {
  const [indiceAtivo, setIndiceAtivo] = useState<number | null>(null);

  const total = dados.reduce((s, d) => s + d.valor, 0);
  const maximo = Math.max(1, ...dados.map((d) => d.valor));

  if (total === 0) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-1 font-display text-base font-semibold text-ink">Movimento de vendas</h2>
        <p className="text-sm text-text-soft">Nenhuma venda faturada no período.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">Movimento de vendas</h2>
        <p className="text-xs text-text-soft">
          total <span className="font-semibold text-rose-deep tabular-nums">{formatarMoeda(total)}</span>
        </p>
      </div>

      <div className="flex gap-3">
        <div className="flex h-40 flex-none flex-col justify-between py-0.5 text-right text-[10px] text-text-soft tabular-nums sm:h-48">
          <span>{formatarMoedaCompacta(maximo)}</span>
          <span>R$ 0</span>
        </div>
        <div className="flex h-40 flex-1 items-end gap-0.5 border-b border-line sm:h-48">
          {dados.map((d, i) => {
            const alturaPct = d.valor > 0 ? Math.max((d.valor / maximo) * 100, 3) : 0;
            const ativo = indiceAtivo === i;
            return (
              <div key={d.data} className="relative flex h-full flex-1 items-end justify-center">
                {ativo && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-md">
                    <p className="font-semibold text-ink tabular-nums">{formatarMoeda(d.valor)}</p>
                    <p className="text-text-soft">{formatarDataIso(d.data)}</p>
                  </div>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setIndiceAtivo(i)}
                  onMouseLeave={() => setIndiceAtivo(null)}
                  onFocus={() => setIndiceAtivo(i)}
                  onBlur={() => setIndiceAtivo(null)}
                  aria-label={`${formatarDataIso(d.data)}: ${formatarMoeda(d.valor)}`}
                  className="flex h-full w-full max-w-[22px] items-end"
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
      <div className="mt-1.5 flex text-[10px] text-text-soft" style={{ paddingLeft: "calc(2.6rem)" }}>
        <span>{formatarDataIso(dados[0].data)}</span>
        <span className="ml-auto">{formatarDataIso(dados[dados.length - 1].data)}</span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-rose-deep hover:underline">
          Ver dados em tabela
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-text-soft">
              <th className="py-1 font-medium">Dia</th>
              <th className="py-1 text-right font-medium">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {dados.map((d) => (
              <tr key={d.data} className="border-t border-line">
                <td className="py-1 text-ink">{formatarDataIso(d.data)}</td>
                <td className="py-1 text-right text-ink tabular-nums">{formatarMoeda(d.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
