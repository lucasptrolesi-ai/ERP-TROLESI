"use client";

import { useMemo, useState } from "react";
import { ProdutoForm } from "@/components/produto-form";
import { filtra } from "@/lib/filtra";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { podeEditarProdutos } from "@/lib/permissoes";
import type { Produto } from "@/lib/types";

function statusEstoque(produto: Produto): { rotulo: string; classe: string } {
  if (produto.quantidade_estoque <= 0) return { rotulo: "Sem estoque", classe: "bg-crit-bg text-crit" };
  if (produto.quantidade_estoque <= produto.estoque_minimo) {
    return { rotulo: `${produto.quantidade_estoque} em estoque`, classe: "bg-warn-bg text-warn" };
  }
  return { rotulo: `${produto.quantidade_estoque} em estoque`, classe: "bg-ok-bg text-ok" };
}

export function EstoqueView({ papelAtual, produtos }: { papelAtual: string; produtos: Produto[] }) {
  const [busca, setBusca] = useState("");
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [produtoEditando, setProdutoEditando] = useState<Produto | null | undefined>(undefined);

  const podeEditar = podeEditarProdutos(papelAtual);

  const categorias = useMemo(() => {
    // Categoria é texto livre (datalist só sugere, não obriga) — agrupa por
    // grafia case-insensitive pra "Prata 925" e "prata 925" caírem no mesmo
    // filtro, mantendo a primeira grafia vista como rótulo do chip.
    const vistas = new Map<string, string>();
    for (const p of produtos) {
      const chave = p.categoria.trim().toLowerCase();
      if (!vistas.has(chave)) vistas.set(chave, p.categoria);
    }
    return Array.from(vistas.values()).sort();
  }, [produtos]);

  const filtrados = useMemo(() => {
    const porCategoria = categoriaAtiva
      ? produtos.filter((p) => p.categoria.trim().toLowerCase() === categoriaAtiva.trim().toLowerCase())
      : produtos;
    return filtra(
      porCategoria,
      busca,
      (p) =>
        `${p.categoria} ${p.subcategoria ?? ""} ${p.subsubcategoria ?? ""} ${p.codigo_interno ?? ""}`,
    );
  }, [produtos, categoriaAtiva, busca]);

  return (
    <div className="rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, categoria ou código interno"
          className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          {categorias.map((c) => (
            <button
              key={c}
              onClick={() => setCategoriaAtiva(categoriaAtiva === c ? null : c)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                categoriaAtiva === c
                  ? "border-rose bg-rose-soft text-rose-deep"
                  : "border-line text-text-soft"
              }`}
            >
              {c}
            </button>
          ))}
          {podeEditar && (
            <button
              onClick={() => setProdutoEditando(null)}
              className="shrink-0 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2 text-sm font-semibold text-white"
            >
              + Novo produto
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 sm:p-5 md:grid-cols-4 lg:grid-cols-5">
        {filtrados.map((p) => {
          const status = statusEstoque(p);
          return (
            <button
              key={p.id}
              onClick={() => podeEditar && setProdutoEditando(p)}
              disabled={!podeEditar}
              className={`flex flex-col overflow-hidden rounded-xl border border-line bg-cream text-left disabled:cursor-default ${
                p.ativo ? "" : "opacity-50"
              }`}
            >
              <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-rose-soft to-gold-end">
                {p.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- fotos vêm de URLs externas (Drive/GMax), sem otimização por enquanto
                  <img
                    src={p.foto_url}
                    alt={p.nome}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-display text-xs text-ink/50">sem foto</span>
                )}
              </div>
              <div className="flex flex-col gap-1 px-3 py-2.5">
                <span className="text-[0.65rem] font-bold uppercase tracking-wide text-text-soft">
                  {[p.categoria, p.subcategoria].filter(Boolean).join(" · ")}
                </span>
                <span className="text-sm font-semibold text-ink">{p.nome}</span>
                {p.codigo_interno && (
                  <span className="font-mono text-[0.7rem] text-text-soft">#{p.codigo_interno}</span>
                )}
                <span className="font-display font-semibold text-rose-deep">{formatarMoeda(p.preco)}</span>
                <span className={`w-fit rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${status.classe}`}>
                  {status.rotulo}
                </span>
                {!p.ativo && (
                  <span className="w-fit rounded-full bg-line px-2 py-0.5 text-[0.7rem] font-bold text-text-soft">
                    Inativo
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {filtrados.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-text-soft">
            Nenhum produto encontrado.
          </p>
        )}
      </div>

      {produtoEditando !== undefined && (
        <ProdutoForm
          key={produtoEditando?.id ?? "novo-produto"}
          aberto
          onFechar={() => setProdutoEditando(undefined)}
          produto={produtoEditando}
          categoriasExistentes={categorias}
        />
      )}
    </div>
  );
}
