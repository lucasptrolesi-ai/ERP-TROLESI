"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataHoraIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import { construirLinhasCupomEvento, type VendaEventoParaCupom } from "@/lib/cupom-linhas-evento";
import { FORMA_LABEL_EVENTO } from "@/lib/forma-pagamento-evento";
import { buscarStatusImpressao, solicitarImpressaoCupom } from "@/lib/actions/impressao";
import { linkWhatsapp } from "@/lib/whatsapp";

type Via = "loja" | "cliente";
type ResultadoEspera = { resultado: "impresso" | "erro" | "tempo_esgotado"; mensagem?: string };

const INTERVALO_POLLING_MS = 1000;
const TENTATIVAS_POLLING = 15;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mesmo fluxo de impressão de cupom-view.tsx (pedidos), adaptado pra venda de
// evento: sem cliente vinculado (telefone sempre digitado na hora) e sem
// parcelas planejadas — venda parcelada no cartão aqui é resolvida direto na
// maquininha, não vira conta a receber no sistema.
export function CupomEventoView({ venda, onNovaVenda }: { venda: VendaEventoParaCupom; onNovaVenda: () => void }) {
  const [via, setVia] = useState<Via>("loja");
  const [perguntarViaCliente, setPerguntarViaCliente] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [erroImpressao, setErroImpressao] = useState<string | null>(null);
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState("");
  const jaImprimiuLoja = useRef(false);
  const imprimindoRef = useRef(false);

  const aguardarConfirmacao = useCallback(async (id: string): Promise<ResultadoEspera> => {
    for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
      await aguardar(INTERVALO_POLLING_MS);
      const status = await buscarStatusImpressao(id);
      if (status.status === "impresso") return { resultado: "impresso" };
      if (status.status === "erro") return { resultado: "erro", mensagem: status.mensagem ?? undefined };
    }
    return { resultado: "tempo_esgotado" };
  }, []);

  const imprimir = useCallback(
    async (viaAlvo: Via) => {
      if (imprimindoRef.current) return;
      imprimindoRef.current = true;
      setImprimindo(true);
      setErroImpressao(null);
      setVia(viaAlvo);

      const solicitacao = await solicitarImpressaoCupom(null, viaAlvo, construirLinhasCupomEvento(venda, viaAlvo));
      if ("erro" in solicitacao) {
        imprimindoRef.current = false;
        setImprimindo(false);
        setErroImpressao(`Não foi possível registrar a impressão: ${solicitacao.erro}`);
        return;
      }

      const espera = await aguardarConfirmacao(solicitacao.id);
      imprimindoRef.current = false;
      setImprimindo(false);

      if (espera.resultado === "impresso") {
        if (viaAlvo === "loja") setPerguntarViaCliente(true);
        else setConcluido(true);
      } else if (espera.resultado === "erro") {
        setErroImpressao(espera.mensagem ?? "A impressora relatou um erro ao imprimir.");
      } else {
        setErroImpressao(
          "Não foi possível confirmar a impressão em 15s — verifique se o computador da impressora está ligado.",
        );
      }
    },
    [venda, aguardarConfirmacao],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (jaImprimiuLoja.current) return;
      jaImprimiuLoja.current = true;
      imprimir("loja");
    }, 300);
    return () => clearTimeout(t);
  }, [imprimir]);

  useEffect(() => {
    function aoTerminarImpressaoManual() {
      if (via === "loja") setPerguntarViaCliente(true);
      else setConcluido(true);
      imprimindoRef.current = false;
      setImprimindo(false);
    }
    window.addEventListener("afterprint", aoTerminarImpressaoManual);
    return () => window.removeEventListener("afterprint", aoTerminarImpressaoManual);
  }, [via]);

  function imprimirViaCliente() {
    setPerguntarViaCliente(false);
    imprimir("cliente");
  }

  function pular() {
    setPerguntarViaCliente(false);
    setConcluido(true);
  }

  function reimprimir(viaEscolhida: Via) {
    setConcluido(false);
    imprimir(viaEscolhida);
  }

  function imprimirManualmenteViaNavegador() {
    if (imprimindoRef.current) return;
    imprimindoRef.current = true;
    setImprimindo(true);
    setErroImpressao(null);
    setTimeout(() => window.print(), 150);
  }

  const mensagemWhatsapp = `Olá! Aqui está o comprovante da sua compra na Trolesi Joias — Agroshow (Venda #${venda.numero}) 💎 Segue o PDF em anexo — obrigado pela preferência!`;

  return (
    <div className="flex flex-col items-center gap-4 py-6 print:gap-0 print:py-0">
      <style>{`
        @media print {
          @page { size: 58mm auto; margin: 0; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="print:w-[54mm] print:p-[2mm] w-[54mm] rounded border border-line bg-surface p-[2mm] font-sans text-[11px] font-medium leading-snug text-black shadow-sm print:shadow-none">
        <p className="text-center text-[10px] font-bold tracking-wide">
          {via === "loja" ? "VIA LOJA" : "VIA CLIENTE"}
        </p>
        <div className="text-center">
          <p className="text-xs font-bold">{EMPRESA.nome} — AGROSHOW</p>
          <p>CNPJ {EMPRESA.cpfCnpj}</p>
        </div>
        <div className="my-1 border-t border-dashed border-black/50" />

        <p>Venda evento #{venda.numero}</p>
        <p>{formatarDataHoraIso(venda.criado_em)}</p>

        {(venda.cliente_nome || venda.cliente_cpf || venda.cliente_telefone) && (
          <>
            <div className="my-1 border-t border-dashed border-black/50" />
            {venda.cliente_nome && <p>Cliente: {venda.cliente_nome}</p>}
            {venda.cliente_cpf && <p>CPF: {venda.cliente_cpf}</p>}
            {venda.cliente_telefone && <p>Tel: {venda.cliente_telefone}</p>}
          </>
        )}

        <div className="my-1 border-t border-dashed border-black/50" />

        <div className="mb-0.5 flex justify-between gap-2 font-bold">
          <span className="flex-1">Qtd Peça</span>
          <span>Preço</span>
        </div>
        {venda.itens.map((item, i) => (
          <div key={i} className="mb-0.5 flex justify-between gap-2">
            <span className="flex-1">
              {item.quantidade}x {item.nome}
            </span>
            <span className="tabular-nums">{formatarMoeda(item.quantidade * item.preco_unitario)}</span>
          </div>
        ))}

        <div className="my-1 border-t border-dashed border-black/50" />

        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatarMoeda(venda.subtotal)}</span>
        </div>
        {venda.valor_desconto > 0 && (
          <div className="flex justify-between">
            <span>Desconto</span>
            <span className="tabular-nums">− {formatarMoeda(venda.valor_desconto)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatarMoeda(venda.total)}</span>
        </div>

        <div className="my-1 border-t border-dashed border-black/50" />

        <p>Pagamento: {FORMA_LABEL_EVENTO[venda.forma_pagamento]}</p>
        {venda.forma_pagamento === "cartao_parcelado" && venda.numero_parcelas > 1 && (
          <p>
            {venda.numero_parcelas}x de {formatarMoeda(venda.total / venda.numero_parcelas)}
          </p>
        )}

        <div className="my-1 border-t border-dashed border-black/50" />
        <p className="text-center">Obrigado pela preferência!</p>
        <p className="text-center text-[9px] text-black/70">Documento não fiscal</p>
      </div>

      <div className="flex flex-col items-center gap-3 print:hidden">
        {perguntarViaCliente && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-4 shadow-md">
            <p className="text-sm font-semibold text-ink">Imprimir via do cliente?</p>
            <div className="flex gap-2">
              <button
                onClick={imprimirViaCliente}
                disabled={imprimindo}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-xs font-semibold text-gold-ink disabled:opacity-60"
              >
                {imprimindo ? "Imprimindo…" : "Sim, imprimir"}
              </button>
              <button
                onClick={pular}
                disabled={imprimindo}
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink disabled:opacity-60"
              >
                Não
              </button>
            </div>
          </div>
        )}

        {concluido && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm font-semibold text-ok">✓ Impressão concluída</p>
            <div className="flex gap-2">
              <button
                onClick={() => reimprimir("loja")}
                disabled={imprimindo}
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink disabled:opacity-60"
              >
                {imprimindo && via === "loja" ? "Imprimindo…" : "Reimprimir via loja"}
              </button>
              <button
                onClick={() => reimprimir("cliente")}
                disabled={imprimindo}
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink disabled:opacity-60"
              >
                {imprimindo && via === "cliente" ? "Imprimindo…" : "Reimprimir via cliente"}
              </button>
            </div>

            <div className="mt-1 flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-3">
              <p className="text-xs text-text-soft">
                Enviar comprovante por WhatsApp — abre a conversa pronta, só falta anexar o PDF (já salvo
                automaticamente) e enviar.
              </p>
              <input
                value={telefoneWhatsapp}
                onChange={(e) => setTelefoneWhatsapp(e.target.value)}
                placeholder="Telefone do cliente (com DDD)"
                className="w-48 rounded-lg border border-line bg-cream px-3 py-1.5 text-center text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
              <a
                href={telefoneWhatsapp.trim() ? linkWhatsapp(telefoneWhatsapp, mensagemWhatsapp) : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!telefoneWhatsapp.trim()}
                onClick={(e) => {
                  if (!telefoneWhatsapp.trim()) e.preventDefault();
                }}
                className="rounded-full bg-[#25D366] px-4 py-2 text-xs font-semibold text-white transition aria-disabled:pointer-events-none aria-disabled:opacity-50"
              >
                📱 Abrir no WhatsApp
              </a>
            </div>

            <button
              onClick={onNovaVenda}
              className="mt-1 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
            >
              Nova venda
            </button>
          </div>
        )}

        {!perguntarViaCliente && !concluido && imprimindo && (
          <p className="text-sm text-text-soft">Aguardando confirmação da impressora…</p>
        )}

        {!perguntarViaCliente && !concluido && !imprimindo && erroImpressao && (
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-crit bg-crit-bg p-4 text-center">
            <p className="text-sm font-semibold text-crit">{erroImpressao}</p>
            <div className="flex gap-2">
              <button
                onClick={() => imprimir(via)}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-xs font-semibold text-gold-ink"
              >
                Tentar novamente
              </button>
              <button
                onClick={imprimirManualmenteViaNavegador}
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
              >
                Imprimir por aqui mesmo
              </button>
            </div>
          </div>
        )}

        {!perguntarViaCliente && !concluido && !imprimindo && !erroImpressao && (
          <button
            onClick={() => imprimir(via)}
            className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
          >
            🖨️ Imprimir novamente
          </button>
        )}
      </div>
    </div>
  );
}
