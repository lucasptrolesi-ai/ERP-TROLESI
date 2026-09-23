"use client";

import { useId, useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { rotuloFormaPagamento, type FormaPagamentoResumo } from "@/lib/dashboard-tipos";

// Rampa monocromática (azul ardósia escuro -> claro), consistente com a cor
// de destaque do resto do app em vez de cores arbitrárias por fatia.
const RAMPA = ["#2b4c6f", "#3f6484", "#567b99", "#6e8fac", "#8fa9c0", "#b3c7d8", "#d3e2ea"];

export function GraficoFormasPagamento({ dados }: { dados: FormaPagamentoResumo[] }) {
  const [indiceAtivo, setIndiceAtivo] = useState<number | null>(null);
  const idBase = useId();
  const total = dados.reduce((s, d) => s + d.total, 0);

  if (total === 0) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-1 font-display text-base font-semibold text-ink">Formas de pagamento</h2>
        <p className="text-sm text-text-soft">Nenhum pagamento registrado no período.</p>
      </div>
    );
  }

  const raio = 60;
  const circ = 2 * Math.PI * raio;
  const acumulados = dados.reduce<number[]>((acc, d, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + dados[i - 1].total);
    return acc;
  }, []);

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">Formas de pagamento</h2>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <svg width="160" height="160" viewBox="0 0 160 160" className="flex-none" role="img" aria-label="Distribuição por forma de pagamento">
          {dados.map((d, i) => {
            const frac = d.total / total;
            const comprimento = frac * circ;
            const offset = -((acumulados[i] / total) * circ);
            const ativo = indiceAtivo === i;
            return (
              <circle
                key={d.forma}
                cx="80"
                cy="80"
                r={raio}
                fill="none"
                stroke={RAMPA[i % RAMPA.length]}
                strokeWidth={ativo ? 30 : 26}
                strokeDasharray={`${comprimento} ${circ - comprimento}`}
                strokeDashoffset={offset}
                transform="rotate(-90 80 80)"
                className="cursor-pointer transition-[stroke-width]"
                onMouseEnter={() => setIndiceAtivo(i)}
                onMouseLeave={() => setIndiceAtivo(null)}
              />
            );
          })}
          <text x="80" y="76" textAnchor="middle" className="fill-text-soft text-[10px]">
            Total
          </text>
          <text x="80" y="92" textAnchor="middle" className="fill-ink text-[13px] font-semibold tabular-nums">
            {formatarMoeda(total)}
          </text>
        </svg>

        <ul className="flex w-full flex-col gap-1.5 text-sm">
          {dados.map((d, i) => {
            const pct = Math.round((d.total / total) * 100);
            return (
              <li
                key={d.forma}
                onMouseEnter={() => setIndiceAtivo(i)}
                onMouseLeave={() => setIndiceAtivo(null)}
                className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${indiceAtivo === i ? "bg-rose-soft" : ""}`}
              >
                <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: RAMPA[i % RAMPA.length] }} />
                <span className="flex-1 text-ink">{rotuloFormaPagamento(d.forma)}</span>
                <span className="text-text-soft">{pct}%</span>
                <span className="w-24 text-right font-medium tabular-nums text-ink">{formatarMoeda(d.total)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <details className="mt-3">
        <summary id={idBase} className="cursor-pointer text-xs font-medium text-rose-deep hover:underline">
          Ver dados em tabela
        </summary>
        <table className="mt-2 w-full text-xs" aria-labelledby={idBase}>
          <thead>
            <tr className="text-left text-text-soft">
              <th className="py-1 font-medium">Forma</th>
              <th className="py-1 text-right font-medium">Qtd.</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {dados.map((d) => (
              <tr key={d.forma} className="border-t border-line">
                <td className="py-1 text-ink">{rotuloFormaPagamento(d.forma)}</td>
                <td className="py-1 text-right tabular-nums text-ink">{d.qtd}</td>
                <td className="py-1 text-right tabular-nums text-ink">{formatarMoeda(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
