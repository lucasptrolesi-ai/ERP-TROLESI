"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import JsBarcode from "jsbarcode";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { filtra } from "@/lib/filtra";
import { exportarEtiquetasExcel } from "@/lib/actions/etiquetas-excel";
import { FotoComZoom } from "@/components/foto-com-zoom";
import { ProdutoEventoForm } from "./produto-evento-form";
import { ImportarProdutoModal } from "./importar-produto-modal";
import type { ProdutoEvento, ProdutoParaImportar } from "@/lib/types";

// Prefixo de letras do código (esquema do usuário: PA, BL, BLF...) vira a
// seção — é a mesma lógica de sugestão de próximo código
// (campo-codigo-produto.tsx), só usada aqui pra agrupar em vez de sugerir.
function prefixoCodigo(codigo: string): string {
  return codigo.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "Outros";
}

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

function statusEstoque(quantidade: number): { rotulo: string; classe: string } {
  if (quantidade <= 0) return { rotulo: "Sem estoque", classe: "bg-crit-bg text-crit" };
  if (quantidade <= 3) return { rotulo: `${quantidade} un.`, classe: "bg-warn-bg text-warn" };
  return { rotulo: `${quantidade} un.`, classe: "bg-ok-bg text-ok" };
}

export function EstoqueEvento({
  produtosEvento,
  produtosReais,
}: {
  produtosEvento: ProdutoEvento[];
  produtosReais: ProdutoParaImportar[];
}) {
  const [editando, setEditando] = useState<ProdutoEvento | null | undefined>(undefined);
  const [etiquetaAtiva, setEtiquetaAtiva] = useState<ProdutoEvento | null>(null);
  const [importando, setImportando] = useState(false);
  const [erroExportacao, setErroExportacao] = useState<string | null>(null);
  const [exportando, iniciarExportacao] = useTransition();
  const [busca, setBusca] = useState("");
  const barcodeRef = useRef<SVGSVGElement>(null);

  // Busca por nome (parcial) ou código (parcial/exato) — mesmo helper já
  // usado no Estoque real, pra manter o mesmo comportamento nos dois lugares.
  const filtrados = useMemo(
    () => filtra(produtosEvento, busca, (p) => p.codigo_interno),
    [produtosEvento, busca],
  );

  // Seções por prefixo do código (PA, BL, BLF...), ordem alfabética; dentro
  // de cada seção, ordem natural do código (PA2 antes de PA10).
  const secoes = useMemo(() => {
    const grupos = new Map<string, ProdutoEvento[]>();
    for (const p of filtrados) {
      const prefixo = prefixoCodigo(p.codigo_interno);
      const grupo = grupos.get(prefixo);
      if (grupo) grupo.push(p);
      else grupos.set(prefixo, [p]);
    }
    return Array.from(grupos.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefixo, itens]) => ({
        prefixo,
        itens: [...itens].sort((a, b) =>
          a.codigo_interno.localeCompare(b.codigo_interno, undefined, { numeric: true }),
        ),
      }));
  }, [filtrados]);

  function handleExportarExcel() {
    setErroExportacao(null);
    iniciarExportacao(async () => {
      const ativos = filtrados.filter((p) => p.ativo);
      const resultado = await exportarEtiquetasExcel(
        ativos.map((p) => ({ codigo: p.codigo_interno, preco: p.preco })),
      );
      if (resultado.erro || !resultado.base64) {
        setErroExportacao(resultado.erro ?? "Não foi possível gerar a planilha.");
        return;
      }
      baixarArquivo(resultado.base64, "etiquetas-pdv-eventos.xlsx");
    });
  }

  useEffect(() => {
    if (etiquetaAtiva && barcodeRef.current) {
      JsBarcode(barcodeRef.current, etiquetaAtiva.codigo_interno, {
        format: "CODE128",
        displayValue: true,
        height: 50,
        margin: 4,
      });
    }
  }, [etiquetaAtiva]);

  return (
    <div>
      {etiquetaAtiva && (
        <div className="flex flex-col items-center gap-4 border-b border-line px-4 py-6 sm:px-5">
          <div className="max-w-[260px] rounded-2xl border border-line bg-cream p-4">
            <p className="font-display text-base font-semibold text-ink">{etiquetaAtiva.nome}</p>
            <p className="mb-2 text-xs text-text-soft">#{etiquetaAtiva.codigo_interno}</p>
            <svg ref={barcodeRef} className="w-full" />
          </div>
          <div className="flex gap-3 print:hidden">
            <button
              onClick={() => window.print()}
              className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
            >
              Imprimir etiqueta
            </button>
            <button
              onClick={() => setEtiquetaAtiva(null)}
              className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className={etiquetaAtiva ? "print:hidden" : ""}>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-sm font-semibold text-ink">Estoque do evento</p>
            <p className="text-xs text-text-soft">{produtosEvento.length} peça(s) cadastrada(s)</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={handleExportarExcel}
              disabled={exportando || produtosEvento.length === 0}
              title="Excel p/ etiquetas"
              className="rounded-full border border-rose px-3 py-2 text-sm font-semibold text-rose-deep disabled:opacity-60"
            >
              {exportando ? "…" : "📊"}
              <span className="hidden sm:inline">{exportando ? " Gerando…" : " Excel p/ etiquetas"}</span>
            </button>
            <button
              onClick={() => setImportando(true)}
              title="Importar do Estoque"
              className="rounded-full border border-rose px-3 py-2 text-sm font-semibold text-rose-deep"
            >
              📥<span className="hidden sm:inline"> Importar do Estoque</span>
            </button>
            <button
              onClick={() => setEditando(null)}
              title="Nova peça"
              className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-3 py-2 text-sm font-semibold text-gold-ink"
            >
              +<span className="hidden sm:inline"> Nova peça</span>
            </button>
          </div>
        </div>
        {erroExportacao && (
          <p className="border-b border-line bg-crit-bg px-4 py-2 text-xs font-medium text-crit sm:px-5">
            {erroExportacao}
          </p>
        )}

        <div className="border-b border-line px-4 py-3 sm:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código"
            className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
          />
        </div>

        {secoes.map(({ prefixo, itens }) => (
          <div key={prefixo} className="overflow-x-auto">
            <p className="bg-cream px-5 py-1.5 text-xs font-bold uppercase tracking-wide text-rose-deep">
              {prefixo} <span className="font-normal text-text-soft">({itens.length})</span>
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                  <th className="px-5 py-2" />
                  <th className="px-5 py-2">Código</th>
                  <th className="px-5 py-2">Nome</th>
                  <th className="px-5 py-2">Preço</th>
                  <th className="px-5 py-2">Estoque</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {itens.map((p) => {
                  const status = statusEstoque(p.quantidade_estoque);
                  return (
                    <tr key={p.id} className={`border-t border-line ${p.ativo ? "" : "opacity-50"}`}>
                      <td className="py-2 pl-5">
                        {p.foto_url ? (
                          <FotoComZoom src={p.foto_url} tamanhoBase="h-28 w-28" />
                        ) : (
                          <span className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-line text-[0.6rem] text-text-soft">
                            sem foto
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-xs text-text-soft">#{p.codigo_interno}</td>
                      <td className="px-5 py-2.5">
                        <button onClick={() => setEditando(p)} className="text-left font-semibold hover:underline">
                          {p.nome}
                        </button>
                        {!p.ativo && <span className="ml-2 text-[0.65rem] text-text-soft">(inativo)</span>}
                      </td>
                      <td className="px-5 py-2.5 tabular-nums">{formatarMoeda(p.preco)}</td>
                      <td className="px-5 py-2.5">
                        <span className={`w-fit rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${status.classe}`}>
                          {status.rotulo}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => setEtiquetaAtiva(p)}
                          className="rounded-full border border-rose px-3 py-1.5 text-xs font-semibold text-rose-deep"
                        >
                          🏷️ Etiqueta
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {secoes.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-text-soft">
            {busca ? "Nenhuma peça encontrada pra essa busca." : "Nenhuma peça cadastrada ainda."}
          </p>
        )}
      </div>

      {editando !== undefined && (
        <ProdutoEventoForm
          aberto
          onFechar={() => setEditando(undefined)}
          produtoEvento={editando}
          codigosExistentes={produtosEvento.map((p) => p.codigo_interno)}
        />
      )}

      <ImportarProdutoModal aberto={importando} onFechar={() => setImportando(false)} produtosReais={produtosReais} />
    </div>
  );
}
