"use client";

import { useActionState, useState } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { salvarCupomEvento } from "@/lib/actions/pdv-eventos";
import { useFecharAoSalvar } from "@/lib/use-fechar-ao-salvar";
import type { CupomEvento } from "@/lib/types";

export function CupomEventoForm({
  aberto,
  onFechar,
  cupom,
}: {
  aberto: boolean;
  onFechar: () => void;
  cupom: CupomEvento | null;
}) {
  const [state, formAction, pending] = useActionState(salvarCupomEvento, undefined);
  const [tipo, setTipo] = useState<"percentual" | "valor">(cupom?.tipo ?? "percentual");
  useFecharAoSalvar(pending, state?.erro, onFechar);

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={cupom ? "Editar cupom" : "Novo cupom"}>
      <form action={formAction} className="flex flex-col gap-4">
        {cupom && <input type="hidden" name="id" value={cupom.id} />}

        <FormField label="Código" name="codigo" defaultValue={cupom?.codigo} required />

        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Tipo</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(["percentual", "valor"] as const).map((opcao) => (
              <button
                key={opcao}
                type="button"
                onClick={() => setTipo(opcao)}
                className={`rounded-lg border px-3 py-2.5 text-center text-sm font-semibold ${
                  tipo === opcao ? "border-rose-deep bg-rose-soft text-rose-deep" : "border-line bg-cream text-ink"
                }`}
              >
                {opcao === "percentual" ? "% Percentual" : "R$ Valor fixo"}
              </button>
            ))}
          </div>
          <input type="hidden" name="tipo" value={tipo} />
        </div>

        <FormField
          label={tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}
          name="valor"
          type="number"
          step="0.01"
          min={0}
          max={tipo === "percentual" ? 100 : undefined}
          defaultValue={cupom?.valor}
          required
        />

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="ativo" defaultChecked={cupom?.ativo ?? true} className="h-4 w-4 accent-rose" />
          Cupom ativo
        </label>

        {state?.erro && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {state.erro}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </form>
    </Modal>
  );
}
