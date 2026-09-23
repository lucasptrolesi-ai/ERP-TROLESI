import { formatarMoeda } from "@/lib/formatar-moeda";
import type { ProdutoResumo } from "@/lib/dashboard-tipos";

export function ListaTopProdutos({ dados }: { dados: ProdutoResumo[] }) {
  const maximo = Math.max(1, ...dados.map((d) => d.total));

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">Produtos mais vendidos</h2>
      {dados.length === 0 ? (
        <p className="text-sm text-text-soft">Nenhuma venda com item no período.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {dados.map((d) => (
            <li key={d.nome} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
              <span className="truncate text-sm text-ink">{d.nome}</span>
              <span className="text-right text-xs tabular-nums text-text-soft">
                {d.quantidade} un · {formatarMoeda(d.total)}
              </span>
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-rose-soft">
                <div
                  className="h-full rounded-full bg-rose-deep"
                  style={{ width: `${Math.max((d.total / maximo) * 100, 3)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
