"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { formatarDataHoraIso, formatarDataIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import { construirLinhasCupom } from "@/lib/cupom-linhas";
import { buscarStatusImpressao, solicitarImpressaoCupom } from "@/lib/actions/impressao";
import type { ContaReceber, Pedido } from "@/lib/types";

type Via = "loja" | "cliente";
type ResultadoEspera = { resultado: "impresso" | "erro" | "tempo_esgotado"; mensagem?: string };

const INTERVALO_POLLING_MS = 1000;
const TENTATIVAS_POLLING = 15; // ~15s — dá tempo do agente pegar a fila e imprimir

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function CupomView({ pedido, parcelas }: { pedido: Pedido; parcelas: ContaReceber[] }) {
  const [via, setVia] = useState<Via>("loja");
  const [perguntarViaCliente, setPerguntarViaCliente] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [erroImpressao, setErroImpressao] = useState<string | null>(null);
  const jaImprimiuLoja = useRef(false);
  // `imprimindo` já bloqueia o clique dos botões, mas o ciclo de gravar +
  // esperar confirmação leva vários segundos — sem essa ref, um segundo
  // clique bem no meio desse intervalo (antes do re-render do `disabled`
  // chegar) ainda entraria em `imprimir()` de novo e duplicaria o pedido.
  const imprimindoRef = useRef(false);

  // A venda pode ter sido fechada em qualquer aparelho (Mac, Windows,
  // celular) — só existe UM print-agent, rodando na máquina que tem a
  // impressora térmica ligada (ver print-agent/), então um fetch direto
  // pro loopback (127.0.0.1) só funcionaria se a venda também tivesse sido
  // feita nela. Em vez disso, grava o pedido de impressão no banco
  // (solicitacoes_impressao) e espera o agente confirmar, com polling.
  const aguardarConfirmacao = useCallback(async (id: string): Promise<ResultadoEspera> => {
    for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
      await aguardar(INTERVALO_POLLING_MS);
      const status = await buscarStatusImpressao(id);
      if (status.status === "impresso") return { resultado: "impresso" };
      if (status.status === "erro") return { resultado: "erro", mensagem: status.mensagem ?? undefined };
    }
    return { resultado: "tempo_esgotado" };
  }, []);

  // Ponto único de impressão: grava a solicitação, espera o agente
  // confirmar. Bloqueado por `imprimindoRef` pra um clique duplo durante a
  // espera não disparar duas impressões da mesma via.
  const imprimir = useCallback(
    async (viaAlvo: Via) => {
      if (imprimindoRef.current) return;
      imprimindoRef.current = true;
      setImprimindo(true);
      setErroImpressao(null);
      setVia(viaAlvo);

      const solicitacao = await solicitarImpressaoCupom(
        pedido.id,
        viaAlvo,
        construirLinhasCupom(pedido, parcelas, viaAlvo),
      );
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
    [pedido, parcelas, aguardarConfirmacao],
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

  // Só dispara quando `imprimirManualmenteViaNavegador` chama window.print()
  // — o caminho principal (agente local) nunca abre a caixa de diálogo do
  // navegador. Dispara tanto ao imprimir quanto ao cancelar, e nos dois
  // casos segue o fluxo (pergunta via cliente / conclui).
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

  // Última saída manual, só usada se o agente não confirmar — imprime a
  // página HTML normal deste navegador (não necessariamente a impressora
  // térmica da loja, mas pelo menos alguma coisa sai se o agente estiver
  // fora do ar). Mesmo guard de `imprimindoRef` do fluxo principal: sem
  // isso, o botão "Imprimir novamente" reaparecia com a caixa de diálogo
  // do navegador ainda aberta, e um clique nele disparava a fila por cima
  // da impressão manual em andamento.
  function imprimirManualmenteViaNavegador() {
    if (imprimindoRef.current) return;
    imprimindoRef.current = true;
    setImprimindo(true);
    setErroImpressao(null);
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
