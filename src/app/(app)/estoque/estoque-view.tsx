"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ProdutoForm } from "@/components/produto-form";
import { CotacaoDoDia } from "@/components/cotacao-do-dia";
import { filtra } from "@/lib/filtra";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { podeEditarProdutos } from "@/lib/permissoes";
import { exportarEtiquetasExcel } from "@/lib/actions/etiquetas-excel";
import type { CotacaoDiaria, Produto } from "@/lib/types";

function baixarArquivo(base64: string, nomeArquivo: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}

function statusEstoque(produto: Produto): { rotulo: string; classe: string } {
  if (produto.quantidade_estoque <= 0) return { rotulo: "Sem estoque", classe: "bg-crit-bg text-crit" };
  if (produto.quantidade_estoque <= produto.estoque_minimo) {
    return { rotulo: `${produto.quantidade_estoque} em estoque`, classe: "bg-warn-bg text-warn" };
  }
  return { rotulo: `${produto.quantidade_estoque} em estoque`, classe: "bg-ok-bg text-ok" };
}

export function EstoqueView({
  papelAtual,
  produtos,
  cotacoesHoje,
  podeInformarCotacao,
  editarId,
}: {
  papelAtual: string;
  produtos: Produto[];
  cotacoesHoje: CotacaoDiaria[];
  podeInformarCotacao: boolean;
  editarId?: string;
}) {
  const [busca, setBusca] = useState("");
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [colecaoAtiva, setColecaoAtiva] = useState<string | null>(null);
  // Suporte ao link "Atualizar estoque" do Vision AI (?editar=<id>): abre já
  // com o produto encontrado como parecido, pra ajustar a quantidade.
  const [produtoEditando, setProdutoEditando] = useState<Produto | null | undefined>(() =>
    editarId ? produtos.find((p) => p.id === editarId) : undefined,
  );

  const podeEditar = podeEditarProdutos(papelAtual);
  const [erroExportacao, setErroExportacao] = useState<string | null>(null);
  const [exportando, iniciarExportacao] = useTransition();

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

  // Mesmo padrão de agrupamento de categoria, pra "coleção" servir de
  // estoque separado (ex: peças exclusivas de um evento) — só aparece a
  // linha de filtro quando existe pelo menos uma coleção cadastrada, pra
  // não poluir a tela de quem nunca usa esse campo.
  const colecoes = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const p of produtos) {
      if (!p.colecao) continue;
      const chave = p.colecao.trim().toLowerCase();
      if (!vistas.has(chave)) vistas.set(chave, p.colecao);
    }
    return Array.from(vistas.values()).sort();
  }, [produtos]);

  const filtrados = useMemo(() => {
    let base = categoriaAtiva
      ? produtos.filter((p) => p.categoria.trim().toLowerCase() === categoriaAtiva.trim().toLowerCase())
      : produtos;
    if (colecaoAtiva) {
      base = base.filter((p) => (p.colecao ?? "").trim().toLowerCase() === colecaoAtiva.trim().toLowerCase());
    }
    return filtra(
      base,
      busca,
      (p) =>
        `${p.categoria} ${p.subcategoria ?? ""} ${p.subsubcategoria ?? ""} ${p.codigo_interno ?? ""} ${p.colecao ?? ""}`,
    );
  }, [produtos, categoriaAtiva, colecaoAtiva, busca]);

  function handleExportarExcel() {
    setErroExportacao(null);
    iniciarExportacao(async () => {
      const itens = filtrados
        .filter((p) => p.ativo && p.codigo_interno)
        .map((p) => ({ codigo: p.codigo_interno as string, preco: p.preco }));
      const resultado = await exportarEtiquetasExcel(itens);
      if (resultado.erro || !resultado.base64) {
        setErroExportacao(resultado.erro ?? "Não foi possível gerar a planilha.");
        return;
      }
      baixarArquivo(resultado.base64, "etiquetas-estoque.xlsx");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <CotacaoDoDia cotacoesHoje={cotacoesHoje} podeInformar={podeInformarCotacao} />
      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, categoria ou código interno"
            className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
          />
          {podeEditar && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportarExcel}
                disabled={exportando || filtrados.length === 0}
                title="Excel p/ etiquetas"
                className="shrink-0 rounded-full border border-rose px-3 py-2 text-sm font-semibold text-rose-deep disabled:opacity-60"
              >
                {exportando ? "…" : "📊"}
                <span className="hidden sm:inline">{exportando ? " Gerando…" : " Excel p/ etiquetas"}</span>
              </button>
              <Link
                href="/estoque/cadastro-ia"
                title="Cadastrar com foto"
                className="shrink-0 rounded-full border border-rose px-3 py-2 text-sm font-semibold text-rose-deep"
              >
                📷<span className="hidden sm:inline"> Cadastrar com foto</span>
              </Link>
              <button
                onClick={() => setProdutoEditando(null)}
                title="Novo produto"
                className="shrink-0 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-3 py-2 text-sm font-semibold text-gold-ink"
              >
                +<span className="hidden sm:inline"> Novo produto</span>
              </button>
            </div>
          )}
        </div>
        {categorias.length > 0 && (
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
          </div>
        )}
      </div>
      {erroExportacao && (
        <p className="border-b border-line bg-crit-bg px-4 py-2 text-xs font-medium text-crit sm:px-5">
          {erroExportacao}
        </p>
      )}

      {colecoes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
          <span className="text-[0.65rem] font-bold uppercase tracking-wide text-text-soft">Coleção</span>
          {colecoes.map((c) => (
            <button
              key={c}
              onClick={() => setColecaoAtiva(colecaoAtiva === c ? null : c)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                colecaoAtiva === c
                  ? "border-rose bg-rose-soft text-rose-deep"
                  : "border-line text-text-soft"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

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
                {p.colecao && (
                  <span className="w-fit rounded-full bg-gold-start/30 px-2 py-0.5 text-[0.65rem] font-bold text-gold-ink">
                    {p.colecao}
                  </span>
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
      </div>

      {produtoEditando !== undefined && (
        <ProdutoForm
          key={produtoEditando?.id ?? "novo-produto"}
          aberto
          onFechar={() => setProdutoEditando(undefined)}
          produto={produtoEditando}
          categoriasExistentes={categorias}
          codigosExistentes={produtos.map((p) => p.codigo_interno).filter((c): c is string => c !== null)}
        />
      )}
    </div>
  );
}
