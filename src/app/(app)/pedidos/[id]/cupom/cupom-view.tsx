"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { formatarDataHoraIso, formatarDataIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import { construirLinhasCupom } from "@/lib/cupom-linhas";
import type { ContaReceber, Pedido } from "@/lib/types";

type Via = "loja" | "cliente";

// Endereço do print-agent local (print-agent/agent.js) — só existe/responde
// nesse mesmo PC, na impressora térmica de verdade. Sem ele (outra máquina,
// ou agente não rodando), cai pro window.print() de sempre.
const URL_PRINT_AGENT = "http://127.0.0.1:41022/imprimir";

export function CupomView({ pedido, parcelas }: { pedido: Pedido; parcelas: ContaReceber[] }) {
  const [via, setVia] = useState<Via>("loja");
  const [perguntarViaCliente, setPerguntarViaCliente] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const jaImprimiuLoja = useRef(false);
  // `imprimindo` já bloqueia o clique dos botões, mas a tentativa do agente
  // local pode levar até 6s (prompt de permissão do Chrome) — sem essa ref,
  // um segundo clique bem no meio desse intervalo (antes do re-render do
  // `disabled` chegar) ainda entraria em `imprimir()` de novo e imprimiria
  // a mesma via duas vezes.
  const imprimindoRef = useRef(false);

  // Tenta o print-agent local primeiro — ESC/POS nativo, nítido (ver
  // DECISIONS.md: impressão via HTML/window.print() sai borrada numa
  // térmica). Se o agente não existir nessa máquina, a conexão falha na
  // hora (ECONNREFUSED, sem essa demora) — o timeout generoso aqui é só
  // pra dar tempo do usuário responder ao prompt de permissão do Chrome
  // ("acessar dispositivos na rede local"), que aparece na 1ª vez por
  // origem e mantém a promise pendente até alguém clicar. Se não
  // responder em 6s, devolve false e quem chamou cai pro window.print().
  const tentarAgenteLocal = useCallback(
    async (viaAlvo: Via): Promise<boolean> => {
      try {
        const controlador = new AbortController();
        const tempoLimite = setTimeout(() => controlador.abort(), 6000);
        const resposta = await fetch(URL_PRINT_AGENT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ via: viaAlvo, linhas: construirLinhasCupom(pedido, parcelas, viaAlvo) }),
          signal: controlador.signal,
        });
        clearTimeout(tempoLimite);
        return resposta.ok;
      } catch {
        return false;
      }
    },
    [pedido, parcelas],
  );

  // Ponto único de impressão: tenta o agente local; se ele não estiver
  // disponível, cai pro fluxo antigo (window.print(), tratado pelo
  // `afterprint` abaixo). Ao usar o agente, não existe evento `afterprint`
  // (não é impressão de página) — segue o fluxo na hora, manualmente.
  // Bloqueado por `imprimindoRef` pra um clique duplo durante os até 6s de
  // espera do agente não disparar duas impressões da mesma via.
  const imprimir = useCallback(
    async (viaAlvo: Via) => {
      if (imprimindoRef.current) return;
      imprimindoRef.current = true;
      setImprimindo(true);
      setVia(viaAlvo);
      const impresso = await tentarAgenteLocal(viaAlvo);
      if (impresso) {
        if (viaAlvo === "loja") setPerguntarViaCliente(true);
        else setConcluido(true);
        imprimindoRef.current = false;
        setImprimindo(false);
      } else {
        // window.print() abre a caixa de diálogo do navegador — só libera
        // o botão de novo quando o `afterprint` (abaixo) confirmar que ela
        // fechou; senão dá pra clicar de novo com a caixa ainda aberta.
        setTimeout(() => window.print(), 150);
      }
    },
    [tentarAgenteLocal],
  );

  // Dispara a impressão da via loja sozinho ao entrar na tela — só uma vez.
  // A flag é marcada dentro do próprio setTimeout (não no corpo do efeito):
  // em StrictMode (dev), o efeito roda/limpa/roda de novo — se a flag fosse
  // marcada no corpo, a 1ª chamada nunca chegaria a imprimir (cancelada
  // pela limpeza) e a 2ª nem tentaria (flag já true), travando o auto-print
  // só em dev. Marcando dentro do callback, só a chamada que sobrevive até
  // disparar de fato conta.
  useEffect(() => {
    const t = setTimeout(() => {
      if (jaImprimiuLoja.current) return;
      jaImprimiuLoja.current = true;
      imprimir("loja");
    }, 300);
    return () => clearTimeout(t);
  }, [imprimir]);

  // `afterprint` só dispara quando a via cai no fallback window.print() —
  // dispara tanto ao imprimir quanto ao cancelar a caixa de diálogo, e nos
  // dois casos segue o fluxo (pergunta via cliente / conclui).
  useEffect(() => {
    function aoTerminarImpressao() {
      if (via === "loja") setPerguntarViaCliente(true);
      else setConcluido(true);
      imprimindoRef.current = false;
      setImprimindo(false);
    }
    window.addEventListener("afterprint", aoTerminarImpressao);
    return () => window.removeEventListener("afterprint", aoTerminarImpressao);
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
          </div>
        )}

        {!perguntarViaCliente && !concluido && imprimindo && (
          <p className="text-sm text-text-soft">Imprimindo…</p>
        )}
        {!perguntarViaCliente && !concluido && !imprimindo && (
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
