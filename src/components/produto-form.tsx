"use client";

import { useActionState, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { salvarProduto, excluirProduto } from "@/lib/actions/produtos";
import { useFecharAoSalvar } from "@/lib/use-fechar-ao-salvar";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { calcularPrecoUnitario, MULTIPLICADOR_PADRAO } from "@/lib/precificacao";
import type { Produto } from "@/lib/types";

export function ProdutoForm({
  aberto,
  onFechar,
  produto,
  categoriasExistentes,
}: {
  aberto: boolean;
  onFechar: () => void;
  produto: Produto | null;
  categoriasExistentes: string[];
}) {
  const [state, formAction, pending] = useActionState(salvarProduto, undefined);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [excluindo, iniciarExclusao] = useTransition();
  const [codigoPeca, setCodigoPeca] = useState(produto?.codigo_peca ?? 0);
  const [multiplicador, setMultiplicador] = useState(produto?.multiplicador ?? MULTIPLICADOR_PADRAO);
  useFecharAoSalvar(pending, state?.erro, onFechar);

  function handleExcluir() {
    if (!produto) return;
    if (!confirm(`Excluir "${produto.nome}"? Essa ação não pode ser desfeita.`)) return;
    setErroExcluir(null);
    iniciarExclusao(async () => {
      const resultado = await excluirProduto(produto.id);
      if (resultado.erro) {
        setErroExcluir(resultado.erro);
      } else {
        onFechar();
      }
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={produto ? "Editar produto" : "Novo produto"}>
      <form action={formAction} className="flex flex-col gap-4">
        {produto && <input type="hidden" name="id" value={produto.id} />}

        <FormField label="Código interno" name="codigo_interno" defaultValue={produto?.codigo_interno} />
        <FormField label="Nome" name="nome" defaultValue={produto?.nome} required />
        <FormField
          label="Categoria"
          name="categoria"
          defaultValue={produto?.categoria}
          required
          list="categorias-existentes"
        />
        <datalist id="categorias-existentes">
          {categoriasExistentes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Subcategoria" name="subcategoria" defaultValue={produto?.subcategoria} />
          <FormField
            label="Subsubcategoria"
            name="subsubcategoria"
            defaultValue={produto?.subsubcategoria}
          />
        </div>

        <FormField label="URL da foto" name="foto_url" defaultValue={produto?.foto_url} />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Código da peça"
            name="codigo_peca"
            type="number"
            step="0.01"
            min={0}
            defaultValue={produto?.codigo_peca ?? 0}
            onChange={(e) => setCodigoPeca(Number(e.target.value) || 0)}
          />
          <FormField
            label="Multiplicador"
            name="multiplicador"
            type="number"
            step="0.1"
            min={0}
            max={99.99}
            defaultValue={produto?.multiplicador ?? MULTIPLICADOR_PADRAO}
            onChange={(e) => setMultiplicador(Number(e.target.value) || 0)}
          />
        </div>
        <p className="-mt-2 text-xs text-text-soft">
          Preço de venda calculado:{" "}
          <span className="font-semibold text-rose-deep">
            {formatarMoeda(calcularPrecoUnitario(codigoPeca, multiplicador))}
          </span>
        </p>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Estoque atual"
            name="quantidade_estoque"
            type="number"
            step="1"
            min={0}
            defaultValue={produto?.quantidade_estoque ?? 0}
          />
          <FormField
            label="Estoque mínimo"
            name="estoque_minimo"
            type="number"
            step="1"
            min={0}
            defaultValue={produto?.estoque_minimo ?? 0}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="ativo"
            defaultChecked={produto?.ativo ?? true}
            className="h-4 w-4 accent-rose"
          />
          Produto ativo (aparece pra venda)
        </label>

        {(state?.erro || erroExcluir) && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {state?.erro ?? erroExcluir}
          </p>
        )}

        <div className="flex gap-3">
          {produto && (
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
