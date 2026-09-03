"use client";

import { useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { CupomEventoForm } from "./cupom-evento-form";
import type { CupomEvento } from "@/lib/types";

export function CuponsEvento({ cupons }: { cupons: CupomEvento[] }) {
  const [editando, setEditando] = useState<CupomEvento | null | undefined>(undefined);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <p className="text-sm font-semibold text-ink">Cupons de desconto</p>
          <p className="text-xs text-text-soft">{cupons.length} cupom(ns) cadastrado(s)</p>
        </div>
        <button
          onClick={() => setEditando(null)}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-3 py-2 text-sm font-semibold text-gold-ink"
        >
          + Novo cupom
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
            <th className="px-5 py-2">Código</th>
            <th className="px-5 py-2">Desconto</th>
            <th className="px-5 py-2">Status</th>
            <th className="px-5 py-2" />
          </tr>
        </thead>
        <tbody>
          {cupons.map((c) => (
            <tr key={c.id} className={`border-t border-line ${c.ativo ? "" : "opacity-50"}`}>
              <td className="px-5 py-2.5 font-mono text-xs font-semibold text-ink">{c.codigo}</td>
              <td className="px-5 py-2.5 tabular-nums">
                {c.tipo === "percentual" ? `${c.valor}%` : formatarMoeda(c.valor)}
              </td>
              <td className="px-5 py-2.5">
                <span
                  className={`w-fit rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${
                    c.ativo ? "bg-ok-bg text-ok" : "bg-crit-bg text-crit"
                  }`}
                >
                  {c.ativo ? "Ativo" : "Inativo"}
                </span>
              </td>
              <td className="px-5 py-2.5 text-right">
                <button onClick={() => setEditando(c)} className="text-xs font-semibold text-rose-deep hover:underline">
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cupons.length === 0 && (
        <p className="px-5 py-8 text-center text-sm text-text-soft">Nenhum cupom cadastrado ainda.</p>
      )}

      {editando !== undefined && (
        <CupomEventoForm aberto onFechar={() => setEditando(undefined)} cupom={editando} />
      )}
    </div>
  );
}
