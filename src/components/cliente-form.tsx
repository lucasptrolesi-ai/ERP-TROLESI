"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { salvarCliente, excluirCliente } from "@/lib/actions/clientes";
import { buscarCnpj } from "@/lib/actions/cnpj";
import { useFecharAoSalvar } from "@/lib/use-fechar-ao-salvar";
import { preencherCampo } from "@/lib/preencher-form";
import type { Cliente } from "@/lib/types";

export function ClienteForm({
  aberto,
  onFechar,
  cliente,
}: {
  aberto: boolean;
  onFechar: () => void;
  cliente: Cliente | null;
}) {
  const [state, formAction, pending] = useActionState(salvarCliente, undefined);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [excluindo, iniciarExclusao] = useTransition();
  const [buscandoCnpj, iniciarBuscaCnpj] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useFecharAoSalvar(pending, state?.erro, onFechar);

  function handleBuscarCnpj() {
    const form = formRef.current;
    if (!form) return;
    const cpfCnpj = (form.elements.namedItem("cpf_cnpj") as HTMLInputElement | null)?.value ?? "";
    setErroCnpj(null);
    iniciarBuscaCnpj(async () => {
      const resultado = await buscarCnpj(cpfCnpj);
      if (resultado.erro) {
        setErroCnpj(resultado.erro);
        return;
      }
      if (resultado.dados) {
        const d = resultado.dados;
        preencherCampo(form, "nome", d.nome);
        preencherCampo(form, "telefone", d.telefone);
        preencherCampo(form, "email", d.email);
        preencherCampo(form, "endereco", d.endereco);
        preencherCampo(form, "bairro", d.bairro);
        preencherCampo(form, "cidade", d.cidade);
        preencherCampo(form, "uf", d.uf);
        preencherCampo(form, "cep", d.cep);
        preencherCampo(form, "razao_social", d.razaoSocial);
        preencherCampo(form, "nome_fantasia", d.nomeFantasia);
        preencherCampo(form, "situacao_cadastral", d.situacaoCadastral);
        preencherCampo(form, "data_abertura", d.dataAbertura);
        preencherCampo(form, "natureza_juridica", d.naturezaJuridica);
        preencherCampo(form, "porte", d.porte);
        preencherCampo(form, "atividade_principal", d.atividadePrincipal);
      }
    });
  }

  function handleExcluir() {
    if (!cliente) return;
    if (!confirm(`Excluir "${cliente.nome}"? Essa ação não pode ser desfeita.`)) return;
    setErroExcluir(null);
    iniciarExclusao(async () => {
      const resultado = await excluirCliente(cliente.id);
      if (resultado.erro) {
        setErroExcluir(resultado.erro);
      } else {
        onFechar();
      }
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={cliente ? "Editar cliente" : "Novo cliente"}>
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        {cliente && <input type="hidden" name="id" value={cliente.id} />}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label="CPF/CNPJ" name="cpf_cnpj" defaultValue={cliente?.cpf_cnpj} />
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

        <FormField label="Nome" name="nome" defaultValue={cliente?.nome} required />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Telefone" name="telefone" defaultValue={cliente?.telefone} />
          <FormField label="E-mail" name="email" type="email" defaultValue={cliente?.email} />
        </div>
        <FormField
          label="Data de nascimento"
          name="data_nascimento"
          type="date"
          defaultValue={cliente?.data_nascimento}
        />
        <FormField label="Endereço" name="endereco" defaultValue={cliente?.endereco} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Bairro" name="bairro" defaultValue={cliente?.bairro} />
          <FormField label="CEP" name="cep" defaultValue={cliente?.cep} />
        </div>
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <FormField label="Cidade" name="cidade" defaultValue={cliente?.cidade} />
          <FormField label="UF" name="uf" defaultValue={cliente?.uf} maxLength={2} />
        </div>

        <div className="mt-1 border-t border-line pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-text-soft">
            Dados da Receita Federal
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Razão social" name="razao_social" defaultValue={cliente?.razao_social} />
          <FormField label="Nome fantasia" name="nome_fantasia" defaultValue={cliente?.nome_fantasia} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Situação cadastral"
            name="situacao_cadastral"
            defaultValue={cliente?.situacao_cadastral}
          />
          <FormField
            label="Data de abertura"
            name="data_abertura"
            type="date"
            defaultValue={cliente?.data_abertura}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Natureza jurídica"
            name="natureza_juridica"
            defaultValue={cliente?.natureza_juridica}
          />
          <FormField label="Porte" name="porte" defaultValue={cliente?.porte} />
        </div>
        <FormField
          label="Atividade principal"
          name="atividade_principal"
          defaultValue={cliente?.atividade_principal}
        />

        {(state?.erro || erroExcluir) && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {state?.erro ?? erroExcluir}
          </p>
        )}

        <div className="flex gap-3">
          {cliente && (
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
