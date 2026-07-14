"use client";

import { useActionState, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { salvarContaPagar, excluirContaPagar } from "@/lib/actions/financeiro";
import { useFecharAoSalvar } from "@/lib/use-fechar-ao-salvar";
import type { ContaPagar, Fornecedor } from "@/lib/types";

export function ContaPagarForm({
  aberto,
  onFechar,
  contaPagar,
  fornecedores,
}: {
  aberto: boolean;
  onFechar: () => void;
  contaPagar: ContaPagar | null;
  fornecedores: Fornecedor[];
}) {
  const [state, formAction, pending] = useActionState(salvarContaPagar, undefined);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [excluindo, iniciarExclusao] = useTransition();
  useFecharAoSalvar(pending, state?.erro, onFechar);

  function handleExcluir() {
    if (!contaPagar) return;
    if (!confirm(`Excluir "${contaPagar.descricao}"? Essa ação não pode ser desfeita.`)) return;
    setErroExcluir(null);
    iniciarExclusao(async () => {
      const resultado = await excluirContaPagar(contaPagar.id);
      if (resultado.erro) {
        setErroExcluir(resultado.erro);
      } else {
        onFechar();
      }
    });
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={contaPagar ? "Editar conta a pagar" : "Nova conta a pagar"}
    >
      <form action={formAction} className="flex flex-col gap-4">
        {contaPagar && <input type="hidden" name="id" value={contaPagar.id} />}

        <FormField label="Descrição" name="descricao" defaultValue={contaPagar?.descricao} required />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="fornecedor_id" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
            Fornecedor
          </label>
          <select
            id="fornecedor_id"
            name="fornecedor_id"
            defaultValue={contaPagar?.fornecedor_id ?? ""}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
          >
            <option value="">— Sem fornecedor vinculado —</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Valor (R$)"
            name="valor"
            type="number"
            step="0.01"
            min={0.01}
            defaultValue={contaPagar?.valor}
            required
          />
          <FormField
            label="Vencimento"
            name="vencimento"
            type="date"
            defaultValue={contaPagar?.vencimento}
            required
          />
        </div>

        {(state?.erro || erroExcluir) && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {state?.erro ?? erroExcluir}
          </p>
        )}

        <div className="flex gap-3">
          {contaPagar && (
            <button
              type="button"
              onClick={handleExcluir}
              disabled={excluindo}
              className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-crit transition disabled:opacity-60"
            >
              {excluindo ? "Excluindo…" : "Excluir"}
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded-full bg-gradient-to-br from-rose to-rose-deep py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
