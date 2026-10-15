"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { buscarStatusEtiqueta, solicitarImpressaoEtiqueta } from "@/lib/actions/varejo";
import { ETIQUETA_CODIGO_MAX, ETIQUETA_LINHA1_PRECO_MAX, ETIQUETA_LINHA3_MAX, preencherEtiquetaAPartirDaPeca } from "@/lib/etiquetas/zpl";

export type PecaParaEtiqueta = {
  produtoId: string;
  variacaoId: string;
  nomeProduto: string;
  categoria: string | null;
  atributos: Record<string, string>;
  precoVenda: number;
  sku: string;
  // Quantidade que acabou de entrar no estoque (cadastro "Veio do Atacado?") — null na reimpressão
  // de uma peça já existente, onde não há esse contexto (vira 1).
  quantidadeEstoque: number | null;
};

const INTERVALO_POLLING_MS = 1000;
const TENTATIVAS_POLLING = 15; // ~15s — mesmo prazo já usado pro cupom térmico

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tela "Imprimir etiqueta" (95×12mm, Elgin L42 Pro Full) — abre sozinha depois de cadastrar uma
 * peça nova, ou pelo botão "Etiqueta" numa peça já existente (catalogo-varejo-view.tsx). Mesmo
 * padrão de fila do cupom térmico: grava em solicitacoes_etiqueta, o print-agent na Mac da loja
 * imprime de verdade e confirma o status (polling, ~15s). */
export function ImprimirEtiquetaModal({ peca, onFechar }: { peca: PecaParaEtiqueta; onFechar: () => void }) {
  const inicial = preencherEtiquetaAPartirDaPeca({
    precoVenda: peca.precoVenda,
    precoFormatado: formatarMoeda(peca.precoVenda),
    atributos: peca.atributos,
    categoria: peca.categoria,
    sku: peca.sku,
    quantidadeEstoque: peca.quantidadeEstoque,
  });

  const [linha1, setLinha1] = useState(inicial.linha1);
  const [preco, setPreco] = useState(inicial.preco);
  const [linha3, setLinha3] = useState(inicial.linha3);
  const [codigo, setCodigo] = useState(inicial.codigo);
  const [quantidade, setQuantidade] = useState(inicial.quantidade);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"parado" | "enviando" | "aguardando" | "impresso" | "erro">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const enviandoRef = useRef(false);

  useEffect(() => {
    let cancelado = false;
    QRCode.toDataURL(codigo || " ", { margin: 1, width: 96, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelado) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelado) setQrDataUrl(null);
      });
    return () => {
      cancelado = true;
    };
  }, [codigo]);

  async function imprimir() {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setErro(null);
    setStatus("enviando");

    const resultado = await solicitarImpressaoEtiqueta({
      produtoId: peca.produtoId,
      variacaoId: peca.variacaoId,
      linha1,
      preco,
      linha3,
      codigo,
      quantidade,
    });
    if ("erro" in resultado) {
      setErro(resultado.erro);
      setStatus("erro");
      enviandoRef.current = false;
      return;
    }

    setStatus("aguardando");
    for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
      await aguardar(INTERVALO_POLLING_MS);
      const statusAtual = await buscarStatusEtiqueta(resultado.id);
      if (statusAtual.status === "impresso") {
        setStatus("impresso");
        enviandoRef.current = false;
        await aguardar(900);
        onFechar();
        return;
      }
      if (statusAtual.status === "erro") {
        setErro(statusAtual.mensagem ?? "Erro desconhecido ao imprimir.");
        setStatus("erro");
        enviandoRef.current = false;
        return;
      }
    }
    setErro("A impressora não confirmou em 15s — confira se o print-agent está rodando na Mac da loja.");
    setStatus("erro");
    enviandoRef.current = false;
  }

  const pendente = status === "enviando" || status === "aguardando";

  return (
    <Modal aberto onFechar={onFechar} titulo="Imprimir etiqueta">
      <div className="flex flex-col gap-4">
        <p className="-mt-1 text-sm text-text-soft">
          {peca.nomeProduto} · peça salva com sucesso
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Pré-visualização · 95 × 12 mm</span>
          <div className="flex justify-center rounded-lg border border-line bg-cream p-3">
            <div className="flex h-16 w-full max-w-[380px] items-stretch gap-0.5">
              <div className="flex flex-[24] flex-col items-center justify-center gap-0.5 rounded-md bg-surface px-1 ring-1 ring-inset ring-line">
                <span className="text-[0.55rem] font-semibold leading-tight">{linha1 || " "}</span>
                <span className="text-sm font-bold leading-none">{preco || " "}</span>
                <span className="text-[0.55rem] font-semibold leading-tight">{linha3 || " "}</span>
              </div>
              <div className="flex flex-[20] items-center gap-1.5 rounded-md bg-surface px-1 ring-1 ring-inset ring-line">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pré-visualização local, não é imagem de produto
                  <img src={qrDataUrl} alt="QR code de pré-visualização" className="h-10 w-10 shrink-0" />
                ) : (
                  <span className="h-10 w-10 shrink-0 rounded bg-cream" />
                )}
                <div className="flex flex-col gap-0.5 text-[0.55rem] font-semibold leading-tight">
                  <span>SKU</span>
                  <span>{codigo || " "}</span>
                </div>
              </div>
              <div className="flex flex-1 items-center rounded-md bg-surface px-3 ring-1 ring-inset ring-line">
                <div className="flex-1 border-t border-dashed border-line" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Linha de cima"
            name="linha1"
            value={linha1}
            onChange={(e) => setLinha1(e.target.value.slice(0, ETIQUETA_LINHA1_PRECO_MAX))}
            maxLength={ETIQUETA_LINHA1_PRECO_MAX}
          />
          <FormField
            label="Preço"
            name="preco"
            value={preco}
            onChange={(e) => setPreco(e.target.value.slice(0, ETIQUETA_LINHA1_PRECO_MAX))}
            maxLength={ETIQUETA_LINHA1_PRECO_MAX}
          />
          <FormField
            label="Linha de baixo"
            name="linha3"
            value={linha3}
            onChange={(e) => setLinha3(e.target.value.slice(0, ETIQUETA_LINHA3_MAX))}
            maxLength={ETIQUETA_LINHA3_MAX}
          />
          <FormField
            label="Código no QR"
            name="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.slice(0, ETIQUETA_CODIGO_MAX))}
            maxLength={ETIQUETA_CODIGO_MAX}
            semCaixaAlta
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Quantidade</span>
          <div className="flex items-center overflow-hidden rounded-lg border border-line">
            <button
              type="button"
              aria-label="Diminuir quantidade"
              onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              className="h-10 w-10 bg-cream text-lg text-ink"
            >
              −
            </button>
            <span className="w-12 text-center text-sm font-semibold">{quantidade}</span>
            <button
              type="button"
              aria-label="Aumentar quantidade"
              onClick={() => setQuantidade((q) => Math.min(999, q + 1))}
              className="h-10 w-10 bg-cream text-lg text-ink"
            >
              +
            </button>
          </div>
        </div>

        {status === "aguardando" && <p className="text-sm text-text-soft">Imprimindo… aguardando o print-agent confirmar.</p>}
        {status === "impresso" && <p className="text-sm font-medium text-ok">Impresso!</p>}
        {erro && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {erro}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={pendente}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
          >
            Agora não
          </button>
          <button
            type="button"
            onClick={imprimir}
            disabled={pendente || codigo.trim() === ""}
            className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-sm font-semibold text-gold-ink disabled:opacity-60"
          >
            {pendente ? "Imprimindo…" : `Imprimir ${quantidade} etiqueta${quantidade === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
