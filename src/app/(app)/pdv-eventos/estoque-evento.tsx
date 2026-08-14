"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { ProdutoEventoForm } from "./produto-evento-form";
import { buscarStatusEtiqueta, solicitarImpressaoEtiqueta } from "@/lib/actions/pdv-eventos";
import type { ProdutoEvento } from "@/lib/types";

function statusEstoque(quantidade: number): { rotulo: string; classe: string } {
  if (quantidade <= 0) return { rotulo: "Sem estoque", classe: "bg-crit-bg text-crit" };
  if (quantidade <= 3) return { rotulo: `${quantidade} un.`, classe: "bg-warn-bg text-warn" };
  return { rotulo: `${quantidade} un.`, classe: "bg-ok-bg text-ok" };
}

const INTERVALO_POLLING_MS = 1000;
const TENTATIVAS_POLLING = 15;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EstadoImpressao = "idle" | "imprimindo" | "impresso" | "erro";

export function EstoqueEvento({ produtosEvento }: { produtosEvento: ProdutoEvento[] }) {
  const [editando, setEditando] = useState<ProdutoEvento | null | undefined>(undefined);
  const [etiquetaAtiva, setEtiquetaAtiva] = useState<ProdutoEvento | null>(null);
  const [estadoImpressao, setEstadoImpressao] = useState<EstadoImpressao>("idle");
  const [erroImpressao, setErroImpressao] = useState<string | null>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);
  // Guarda o id da peça com o modal aberto no momento — sem isso, a
  // impressão de A (ainda em polling) pode terminar depois do usuário já
  // ter fechado e aberto a etiqueta de B, e sobrescrever o estado exibido
  // de B com o resultado de A (achado de code review, 2026-08-14).
  const etiquetaAtivaIdRef = useRef<string | null>(null);
  // Trava síncrona contra duplo-clique — o `disabled` do botão só reflete
  // o estado depois de um re-render, um clique duplo bem rápido ainda
  // dispara imprimir() duas vezes sem isso (mesmo padrão de
  // cupom-evento-view.tsx). Por id (não um boolean único) pra não travar a
  // peça B enquanto a impressão da peça A ainda está em polling.
  const idsEmImpressaoRef = useRef<Set<string>>(new Set());

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

  // Mesmo padrão de fila/polling do cupom (CupomEventoView) — grava o
  // pedido de etiqueta e espera o print-agent do Windows (SERVIDOR, com a
  // Argox calibrada) confirmar, em vez de imprimir pela impressora padrão
  // deste navegador (que quase nunca é a etiquetadora física da loja).
  const imprimir = useCallback(async (produto: ProdutoEvento) => {
    const produtoId = produto.id;
    if (idsEmImpressaoRef.current.has(produtoId)) return;
    idsEmImpressaoRef.current.add(produtoId);
    // Só atualiza a tela se o modal aberto ainda for desta mesma peça —
    // evita o resultado de uma impressão antiga "vazar" pra outra peça
    // aberta depois (ver comentário no useRef acima).
    const aindaAtivo = () => etiquetaAtivaIdRef.current === produtoId;

    if (aindaAtivo()) {
      setEstadoImpressao("imprimindo");
      setErroImpressao(null);
    }

    const solicitacao = await solicitarImpressaoEtiqueta(produto.codigo_interno, produto.nome);
    if ("erro" in solicitacao) {
      idsEmImpressaoRef.current.delete(produtoId);
      if (aindaAtivo()) {
        setEstadoImpressao("erro");
        setErroImpressao(`Não foi possível registrar a impressão: ${solicitacao.erro}`);
      }
      return;
    }

    for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
      await aguardar(INTERVALO_POLLING_MS);
      const status = await buscarStatusEtiqueta(solicitacao.id);
      if (status.status === "impresso") {
        idsEmImpressaoRef.current.delete(produtoId);
        if (aindaAtivo()) setEstadoImpressao("impresso");
        return;
      }
      if (status.status === "erro") {
        idsEmImpressaoRef.current.delete(produtoId);
        if (aindaAtivo()) {
          setEstadoImpressao("erro");
          setErroImpressao(status.mensagem ?? "A impressora relatou um erro ao imprimir.");
        }
        return;
      }
    }
    idsEmImpressaoRef.current.delete(produtoId);
    if (aindaAtivo()) {
      setEstadoImpressao("erro");
      setErroImpressao(
        "Não foi possível confirmar a impressão em 15s — verifique se o computador da impressora (SERVIDOR) está ligado.",
      );
    }
  }, []);

  function abrirEtiqueta(produto: ProdutoEvento) {
    etiquetaAtivaIdRef.current = produto.id;
    setEtiquetaAtiva(produto);
    setEstadoImpressao("idle");
    setErroImpressao(null);
  }

  function fecharEtiqueta() {
    etiquetaAtivaIdRef.current = null;
    setEtiquetaAtiva(null);
  }

  return (
    <div>
      {etiquetaAtiva && (
        <div className="flex flex-col items-center gap-4 border-b border-line px-4 py-6 sm:px-5">
          <div className="max-w-[260px] rounded-2xl border border-line bg-cream p-4">
            <p className="font-display text-base font-semibold text-ink">{etiquetaAtiva.nome}</p>
            <p className="mb-2 text-xs text-text-soft">#{etiquetaAtiva.codigo_interno}</p>
            <svg ref={barcodeRef} className="w-full" />
          </div>

          {estadoImpressao === "impresso" && <p className="text-sm font-semibold text-ok">✓ Etiqueta impressa</p>}
          {erroImpressao && (
            <p className="max-w-xs text-center text-sm font-medium text-crit">{erroImpressao}</p>
          )}

          <div className="flex flex-wrap justify-center gap-3 print:hidden">
            <button
              onClick={() => imprimir(etiquetaAtiva)}
              disabled={estadoImpressao === "imprimindo"}
              className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
            >
              {estadoImpressao === "imprimindo"
                ? "Imprimindo…"
                : estadoImpressao === "impresso"
                  ? "Imprimir de novo"
                  : erroImpressao
                    ? "Tentar novamente"
                    : "Imprimir etiqueta"}
            </button>
            {erroImpressao && (
              <button
                onClick={() => window.print()}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Imprimir por aqui mesmo
              </button>
            )}
            <button
              onClick={fecharEtiqueta}
              className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className={etiquetaAtiva ? "print:hidden" : ""}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <p className="text-sm font-semibold text-ink">Estoque do evento</p>
            <p className="text-xs text-text-soft">{produtosEvento.length} peça(s) cadastrada(s)</p>
          </div>
          <button
            onClick={() => setEditando(null)}
            className="shrink-0 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-sm font-semibold text-gold-ink"
          >
            + Nova peça
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Código</th>
                <th className="px-5 py-2">Nome</th>
                <th className="px-5 py-2">Preço</th>
                <th className="px-5 py-2">Estoque</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {produtosEvento.map((p) => {
                const status = statusEstoque(p.quantidade_estoque);
                return (
                  <tr key={p.id} className={`border-t border-line ${p.ativo ? "" : "opacity-50"}`}>
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
                        onClick={() => abrirEtiqueta(p)}
                        className="rounded-full border border-rose px-3 py-1.5 text-xs font-semibold text-rose-deep"
                      >
                        🏷️ Etiqueta
                      </button>
                    </td>
                  </tr>
                );
              })}
              {produtosEvento.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhuma peça cadastrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editando !== undefined && (
        <ProdutoEventoForm aberto onFechar={() => setEditando(undefined)} produtoEvento={editando} />
      )}
    </div>
  );
}
