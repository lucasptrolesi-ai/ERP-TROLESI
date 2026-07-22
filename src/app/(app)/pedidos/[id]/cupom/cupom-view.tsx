"use client";

import { useEffect, useRef, useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { formatarDataHoraIso, formatarDataIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import type { ContaReceber, Pedido } from "@/lib/types";

type Via = "loja" | "cliente";

export function CupomView({ pedido, parcelas }: { pedido: Pedido; parcelas: ContaReceber[] }) {
  const [via, setVia] = useState<Via>("loja");
  const [perguntarViaCliente, setPerguntarViaCliente] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const jaImprimiuLoja = useRef(false);

  // Abre a caixa de impressão da via loja sozinho ao entrar na tela — só
  // uma vez. A flag é marcada dentro do próprio setTimeout (não no corpo do
  // efeito): em StrictMode (dev), o efeito roda/limpa/roda de novo — se a
  // flag fosse marcada no corpo, a 1ª chamada nunca imprimiria (cancelada
  // pela limpeza) e a 2ª nem tentaria (flag já true), travando o auto-print
  // só em dev. Marcando dentro do callback, só o timer que sobrevive até
  // disparar de fato conta.
  useEffect(() => {
    const t = setTimeout(() => {
      if (jaImprimiuLoja.current) return;
      jaImprimiuLoja.current = true;
      window.print();
    }, 300);
    return () => clearTimeout(t);
  }, []);

  // `afterprint` dispara tanto ao imprimir quanto ao cancelar a caixa de
  // diálogo — nos dois casos, segue o fluxo (pergunta via cliente / conclui).
  useEffect(() => {
    function aoTerminarImpressao() {
      if (via === "loja") setPerguntarViaCliente(true);
      else setConcluido(true);
    }
    window.addEventListener("afterprint", aoTerminarImpressao);
    return () => window.removeEventListener("afterprint", aoTerminarImpressao);
  }, [via]);

  function imprimirViaCliente() {
    setPerguntarViaCliente(false);
    setVia("cliente");
    setTimeout(() => window.print(), 150);
  }

  function pular() {
    setPerguntarViaCliente(false);
    setConcluido(true);
  }

  function reimprimir(viaEscolhida: Via) {
    setConcluido(false);
    setVia(viaEscolhida);
    setTimeout(() => window.print(), 150);
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6 print:gap-0 print:py-0">
      <style>{`
        @media print {
          @page { size: 58mm auto; margin: 0; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* Preto puro (não o --color-ink da marca, que é um marrom escuro) —
          numa impressora térmica monocromática, qualquer cor que não seja
          #000 sai como uma trama cinza mais fraca em vez de preto sólido. */}
      <div className="print:w-[54mm] print:p-[2mm] w-[54mm] rounded border border-line bg-surface p-[2mm] font-sans text-[11px] font-medium leading-snug text-black shadow-sm print:shadow-none">
        <p className="text-center text-[10px] font-bold tracking-wide">
          {via === "loja" ? "VIA LOJA" : "VIA CLIENTE"}
        </p>
        <div className="text-center">
          <p className="text-xs font-bold">{EMPRESA.nome}</p>
          <p>CNPJ {EMPRESA.cpfCnpj}</p>
          <p>
            {EMPRESA.endereco.logradouro}, {EMPRESA.endereco.numero}
          </p>
          <p>{EMPRESA.endereco.bairro}</p>
          <p>
            {EMPRESA.endereco.cidade}/{EMPRESA.endereco.uf}
          </p>
        </div>
        <div className="my-1 border-t border-dashed border-black/50" />

        <p>Pedido #{pedido.numero}</p>
        <p>{formatarDataHoraIso(pedido.criado_em)}</p>
        <p>Cliente: {pedido.clientes?.nome ?? "—"}</p>

        <div className="my-1 border-t border-dashed border-black/50" />

        {pedido.pedido_itens.map((item, i) => (
          <div key={i} className="mb-0.5 flex justify-between gap-2">
            <span className="flex-1">
              {item.quantidade}x {item.produtos?.nome ?? "Produto"}
            </span>
            <span className="tabular-nums">{formatarMoeda(item.quantidade * item.preco_unitario)}</span>
          </div>
        ))}

        <div className="my-1 border-t border-dashed border-black/50" />

        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatarMoeda(pedido.subtotal)}</span>
        </div>
        {pedido.valor_desconto > 0 && (
          <div className="flex justify-between">
            <span>Desconto</span>
            <span className="tabular-nums">− {formatarMoeda(pedido.valor_desconto)}</span>
          </div>
        )}
        {pedido.valor_acrescimo > 0 && (
          <div className="flex justify-between">
            <span>Acréscimo</span>
            <span className="tabular-nums">+ {formatarMoeda(pedido.valor_acrescimo)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatarMoeda(pedido.total)}</span>
        </div>

        <div className="my-1 border-t border-dashed border-black/50" />

        <p>Pagamento: {pedido.forma_pagamento ? FORMA_LABEL[pedido.forma_pagamento] : "—"}</p>
        {pedido.forma_pagamento === "misto" &&
          pedido.pedido_pagamentos_mistos.map((p, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span>{FORMA_LABEL[p.forma_pagamento]}</span>
              <span className="tabular-nums">{formatarMoeda(p.valor)}</span>
            </div>
          ))}
        {parcelas.length > 0 &&
          parcelas.map((p) => (
            <p key={p.id}>
              Parc. {p.numero_parcela}/{p.total_parcelas} — vence {formatarDataIso(p.vencimento)} —{" "}
              {formatarMoeda(p.valor)}
            </p>
          ))}

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
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-xs font-semibold text-gold-ink"
              >
                Sim, imprimir
              </button>
              <button onClick={pular} className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink">
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
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
              >
                Reimprimir via loja
              </button>
              <button
                onClick={() => reimprimir("cliente")}
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
              >
                Reimprimir via cliente
              </button>
            </div>
          </div>
        )}

        {!perguntarViaCliente && !concluido && (
          <button
            onClick={() => window.print()}
            className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
          >
            🖨️ Imprimir novamente
          </button>
        )}
      </div>
    </div>
  );
}
