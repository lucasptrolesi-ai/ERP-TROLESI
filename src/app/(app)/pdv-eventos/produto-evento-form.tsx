"use client";

import { useActionState, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { CampoFotoProduto } from "@/components/campo-foto-produto";
import { salvarProdutoEvento, excluirProdutoEvento } from "@/lib/actions/pdv-eventos";
import { useFecharAoSalvar } from "@/lib/use-fechar-ao-salvar";
import type { ProdutoEvento } from "@/lib/types";

export function ProdutoEventoForm({
  aberto,
  onFechar,
  produtoEvento,
}: {
  aberto: boolean;
  onFechar: () => void;
  produtoEvento: ProdutoEvento | null;
}) {
  const [state, formAction, pending] = useActionState(salvarProdutoEvento, undefined);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [excluindo, iniciarExclusao] = useTransition();
  useFecharAoSalvar(pending, state?.erro, onFechar);

  function handleExcluir() {
    if (!produtoEvento) return;
    if (!confirm(`Excluir "${produtoEvento.nome}"? Essa ação não pode ser desfeita.`)) return;
    setErroExcluir(null);
    iniciarExclusao(async () => {
      const resultado = await excluirProdutoEvento(produtoEvento.id);
      if (resultado.erro) {
        setErroExcluir(resultado.erro);
      } else {
        onFechar();
      }
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={produtoEvento ? "Editar peça" : "Nova peça"}>
      <form action={formAction} className="flex flex-col gap-4">
        {produtoEvento && <input type="hidden" name="id" value={produtoEvento.id} />}

        <FormField label="Nome" name="nome" defaultValue={produtoEvento?.nome} required />
        <CampoFotoProduto fotoAtual={produtoEvento?.foto_url} />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Preço (R$)"
            name="preco"
            type="number"
            step="0.01"
            min={0}
            defaultValue={produtoEvento?.preco ?? 0}
            required
          />
          <FormField
            label="Estoque"
            name="quantidade_estoque"
            type="number"
            step="1"
            min={0}
            defaultValue={produtoEvento?.quantidade_estoque ?? 0}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="ativo"
            defaultChecked={produtoEvento?.ativo ?? true}
            className="h-4 w-4 accent-rose"
          />
          Peça ativa (aparece pra venda)
        </label>

        {(state?.erro || erroExcluir) && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {state?.erro ?? erroExcluir}
          </p>
        )}

        <div className="flex gap-3">
          {produtoEvento && (
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
            className="flex-1 rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
