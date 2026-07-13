"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { salvarFornecedor, excluirFornecedor } from "@/lib/actions/fornecedores";
import { buscarCnpj } from "@/lib/actions/cnpj";
import { useFecharAoSalvar } from "@/lib/use-fechar-ao-salvar";
import { preencherCampo } from "@/lib/preencher-form";
import type { Fornecedor } from "@/lib/types";

export function FornecedorForm({
  aberto,
  onFechar,
  fornecedor,
}: {
  aberto: boolean;
  onFechar: () => void;
  fornecedor: Fornecedor | null;
}) {
  const [state, formAction, pending] = useActionState(salvarFornecedor, undefined);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [excluindo, iniciarExclusao] = useTransition();
  const [buscandoCnpj, iniciarBuscaCnpj] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useFecharAoSalvar(pending, state?.erro, onFechar);

  function handleBuscarCnpj() {
    const form = formRef.current;
    if (!form) return;
    const cnpj = (form.elements.namedItem("cnpj") as HTMLInputElement | null)?.value ?? "";
    setErroCnpj(null);
    iniciarBuscaCnpj(async () => {
      const resultado = await buscarCnpj(cnpj);
      if (resultado.erro) {
        setErroCnpj(resultado.erro);
        return;
      }
      if (resultado.dados) {
        const d = resultado.dados;
        preencherCampo(form, "nome", d.nome);
        preencherCampo(form, "telefone", d.telefone);
        preencherCampo(form, "cidade", d.cidade);
        preencherCampo(form, "uf", d.uf);
      }
    });
  }

  function handleExcluir() {
    if (!fornecedor) return;
    if (!confirm(`Excluir "${fornecedor.nome}"? Essa ação não pode ser desfeita.`)) return;
    setErroExcluir(null);
    iniciarExclusao(async () => {
      const resultado = await excluirFornecedor(fornecedor.id);
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
      titulo={fornecedor ? "Editar fornecedor" : "Novo fornecedor"}
    >
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        {fornecedor && <input type="hidden" name="id" value={fornecedor.id} />}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label="CNPJ" name="cnpj" defaultValue={fornecedor?.cnpj} />
          </div>
          <button
            type="button"
            onClick={handleBuscarCnpj}
            disabled={buscandoCnpj}
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-rose-deep transition disabled:opacity-60"
          >
            {buscandoCnpj ? "Buscando…" : "Buscar CNPJ"}
          </button>
        </div>
        {erroCnpj && <p className="-mt-2 text-xs text-crit">{erroCnpj}</p>}

        <FormField label="Nome" name="nome" defaultValue={fornecedor?.nome} required />
        <FormField label="Telefone" name="telefone" defaultValue={fornecedor?.telefone} />
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <FormField label="Cidade" name="cidade" defaultValue={fornecedor?.cidade} />
          <FormField label="UF" name="uf" defaultValue={fornecedor?.uf} maxLength={2} />
        </div>

        {(state?.erro || erroExcluir) && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {state?.erro ?? erroExcluir}
          </p>
        )}

        <div className="flex gap-3">
          {fornecedor && (
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
