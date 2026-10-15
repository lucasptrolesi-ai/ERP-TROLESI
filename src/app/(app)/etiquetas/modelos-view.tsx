import Link from "next/link";
import { PreviaModelo } from "./previa-modelo";
import type { ModeloResumo } from "@/lib/actions/etiquetas";

/** Lista de modelos (sem editor ainda — Fase B). "Editar"/"+ Novo modelo" aparecem esmaecidos de
 * propósito: a rota do editor (/etiquetas/modelos/[id]) não existe nesta fase, mostrar um link que
 * daria 404 seria pior que avisar que ainda não dá. */
export function ModelosEtiquetaView({ modelos }: { modelos: ModeloResumo[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modelos.map((modelo) => (
          <div key={modelo.id} className={`flex flex-col gap-3 rounded-[14px] border bg-surface p-4 shadow-sm ${modelo.padrao_varejo ? "border-rose-deep" : "border-line"}`}>
            <PreviaModelo largura_mm={modelo.largura_mm} altura_mm={modelo.altura_mm} elementos={modelo.elementos} />
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{modelo.nome}</span>
                {modelo.padrao_varejo && (
                  <span className="shrink-0 rounded-full bg-rose-soft px-2 py-0.5 text-[0.65rem] font-semibold text-rose-deep">Padrão do Varejo</span>
                )}
              </div>
              <span className="text-xs text-text-soft">
                {modelo.largura_mm} × {modelo.altura_mm} mm
              </span>
            </div>
            <div className="flex gap-2">
              <span title="Editor ainda não existe (próxima fase)" className="flex-1 cursor-not-allowed rounded-lg border border-line py-2 text-center text-sm text-text-soft/50">
                Editar
              </span>
              <Link
                href={`/etiquetas/lote?modelo=${modelo.id}`}
                className="flex-1 rounded-lg bg-rose-soft py-2 text-center text-sm font-semibold text-rose-deep"
              >
                Imprimir
              </Link>
            </div>
          </div>
        ))}

        <span
          title="Editor ainda não existe (próxima fase)"
          className="flex min-h-[220px] cursor-not-allowed flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-line text-text-soft/60"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="text-sm font-semibold">Novo modelo</span>
          <span className="text-xs">Editor chega na próxima fase</span>
        </span>
      </div>

      {modelos.length === 0 && (
        <p className="rounded-[14px] border border-dashed border-line bg-surface p-6 text-center text-sm text-text-soft">
          Nenhum modelo de etiqueta cadastrado ainda.
        </p>
      )}
    </div>
  );
}
