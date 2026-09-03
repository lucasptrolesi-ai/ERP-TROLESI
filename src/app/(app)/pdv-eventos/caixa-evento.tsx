"use client";

import { useMemo, useState, useTransition } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataHoraIso, dataLocalDoTimestamptz, hojeIso } from "@/lib/datas";
import { FORMA_LABEL_EVENTO } from "@/lib/forma-pagamento-evento";
import { calcularResumoFechamentoCaixa } from "@/lib/fechamento-caixa-evento";
import { construirLinhasFechamentoCaixa } from "@/lib/linhas-fechamento-caixa-evento";
import {
  registrarAberturaCaixaEvento,
  registrarMovimentoCaixaEvento,
  fecharCaixaEvento,
} from "@/lib/actions/pdv-eventos";
import { solicitarImpressaoCupom, buscarStatusImpressao } from "@/lib/actions/impressao";
import type { MovimentoCaixaEvento, VendaEvento } from "@/lib/types";

const INTERVALO_POLLING_MS = 1000;
const TENTATIVAS_POLLING = 15;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function CaixaEvento({
  vendasEvento,
  movimentos: movimentosProp,
  valorAberturaHoje,
}: {
  vendasEvento: VendaEvento[];
  movimentos: MovimentoCaixaEvento[];
  valorAberturaHoje: number | null;
}) {
  const hoje = hojeIso();
  const [movimentosHoje, setMovimentosHoje] = useState(() =>
    movimentosProp.filter((m) => dataLocalDoTimestamptz(m.criado_em) === hoje),
  );

  const [valorAbertura, setValorAbertura] = useState(valorAberturaHoje);
  const [inputAbertura, setInputAbertura] = useState(String(valorAberturaHoje ?? ""));
  const [salvandoAbertura, iniciarAbertura] = useTransition();
  const [erroAbertura, setErroAbertura] = useState<string | null>(null);

  const [tipoMovimento, setTipoMovimento] = useState<"entrada" | "retirada">("retirada");
  const [valorMovimento, setValorMovimento] = useState("");
  const [motivoMovimento, setMotivoMovimento] = useState("");
  const [erroMovimento, setErroMovimento] = useState<string | null>(null);
  const [registrandoMovimento, iniciarMovimento] = useTransition();

  const [fechando, setFechando] = useState(false);
  const [erroFechamento, setErroFechamento] = useState<string | null>(null);
  const [statusImpressao, setStatusImpressao] = useState<"ocioso" | "imprimindo" | "impresso" | "erro">("ocioso");

  const vendasHoje = useMemo(
    () => vendasEvento.filter((v) => dataLocalDoTimestamptz(v.criado_em) === hoje),
    [vendasEvento, hoje],
  );
  const resumo = useMemo(
    () => calcularResumoFechamentoCaixa(vendasHoje, movimentosHoje, valorAbertura ?? 0),
    [vendasHoje, movimentosHoje, valorAbertura],
  );

  function handleAbertura(e: React.FormEvent) {
    e.preventDefault();
    const valor = Number(inputAbertura.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      setErroAbertura("Informe um valor válido.");
      return;
    }
    setErroAbertura(null);
    iniciarAbertura(async () => {
      const resultado = await registrarAberturaCaixaEvento(valor);
      if (resultado.erro) {
        setErroAbertura(resultado.erro);
        return;
      }
      setValorAbertura(valor);
    });
  }

  function handleMovimento(e: React.FormEvent) {
    e.preventDefault();
    const valor = Number(valorMovimento.replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) {
      setErroMovimento("Informe um valor válido.");
      return;
    }
    if (!motivoMovimento.trim()) {
      setErroMovimento("Informe o motivo.");
      return;
    }
    setErroMovimento(null);
    iniciarMovimento(async () => {
      const resultado = await registrarMovimentoCaixaEvento(tipoMovimento, valor, motivoMovimento);
      if (resultado.erro) {
        setErroMovimento(resultado.erro);
        return;
      }
      setMovimentosHoje((atual) => [
        ...atual,
        {
          id: crypto.randomUUID(),
          tipo: tipoMovimento,
          valor,
          motivo: motivoMovimento.trim(),
          criado_em: new Date().toISOString(),
        },
      ]);
      setValorMovimento("");
      setMotivoMovimento("");
    });
  }

  async function handleFecharCaixa() {
    setFechando(true);
    setErroFechamento(null);
    setStatusImpressao("ocioso");

    const resultado = await fecharCaixaEvento();
    if ("erro" in resultado) {
      setFechando(false);
      setErroFechamento(resultado.erro);
      return;
    }

    setStatusImpressao("imprimindo");
    const linhas = construirLinhasFechamentoCaixa(hoje, resumo, resultado.movimentos);
    const solicitacao = await solicitarImpressaoCupom(null, "loja", linhas);
    if ("erro" in solicitacao) {
      setFechando(false);
      setStatusImpressao("erro");
      setErroFechamento(`Caixa fechado, mas não foi possível enviar pra impressora: ${solicitacao.erro}`);
      return;
    }

    for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
      await aguardar(INTERVALO_POLLING_MS);
      const status = await buscarStatusImpressao(solicitacao.id);
      if (status.status === "impresso") {
        setStatusImpressao("impresso");
        setFechando(false);
        return;
      }
      if (status.status === "erro") {
        setStatusImpressao("erro");
        setErroFechamento(`Caixa fechado, mas a impressora relatou um erro: ${status.mensagem ?? "erro desconhecido"}`);
        setFechando(false);
        return;
      }
    }

    setStatusImpressao("erro");
    setErroFechamento("Caixa fechado, mas não foi possível confirmar a impressão em 15s — verifique a impressora.");
    setFechando(false);
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="mb-2 text-sm font-semibold text-ink">Abertura do caixa (troco inicial)</p>
        <form onSubmit={handleAbertura} className="flex gap-2">
          <input
            value={inputAbertura}
            onChange={(e) => setInputAbertura(e.target.value)}
            placeholder="Valor (R$)"
            inputMode="decimal"
            className="w-32 rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
          />
          <button
            type="submit"
            disabled={salvandoAbertura}
            className="rounded-lg border border-rose px-4 py-2 text-sm font-semibold text-rose-deep disabled:opacity-60"
          >
            {salvandoAbertura ? "Salvando…" : valorAbertura != null ? "Atualizar" : "Abrir caixa"}
          </button>
        </form>
        {valorAbertura != null && (
          <p className="mt-1 text-xs text-text-soft">Caixa aberto hoje com {formatarMoeda(valorAbertura)}.</p>
        )}
        {erroAbertura && <p className="mt-2 text-xs font-medium text-crit">{erroAbertura}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["dinheiro", "pix", "cartao_vista", "cartao_parcelado"] as const).map((forma) => (
          <div key={forma} className="rounded-xl border border-line bg-cream p-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">{FORMA_LABEL_EVENTO[forma]}</p>
            <p className="font-display text-lg font-semibold text-ink">{formatarMoeda(resumo.porFormaPagamento[forma])}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex justify-between text-sm">
          <span className="text-text-soft">Abertura do caixa</span>
          <span className="font-semibold tabular-nums">{formatarMoeda(resumo.valorAbertura)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-soft">Total vendido em dinheiro</span>
          <span className="font-semibold tabular-nums">{formatarMoeda(resumo.porFormaPagamento.dinheiro)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-soft">Entradas de hoje</span>
          <span className="font-semibold tabular-nums text-ok">+ {formatarMoeda(resumo.totalEntradas)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-soft">Retiradas de hoje</span>
          <span className="font-semibold tabular-nums text-crit">− {formatarMoeda(resumo.totalRetiradas)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 text-base font-bold text-ink">
          <span>Saldo em dinheiro</span>
          <span className="tabular-nums">{formatarMoeda(resumo.saldoDinheiro)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="mb-2 text-sm font-semibold text-ink">Entrada / retirada do caixa</p>
        <form onSubmit={handleMovimento} className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {(["entrada", "retirada"] as const).map((opcao) => (
              <button
                key={opcao}
                type="button"
                onClick={() => setTipoMovimento(opcao)}
                className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${
                  tipoMovimento === opcao
                    ? "border-rose-deep bg-rose-soft text-rose-deep"
                    : "border-line bg-cream text-ink"
                }`}
              >
                {opcao === "entrada" ? "＋ Entrada" : "− Retirada"}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={valorMovimento}
              onChange={(e) => setValorMovimento(e.target.value)}
              placeholder="Valor (R$)"
              inputMode="decimal"
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft sm:w-32"
            />
            <input
              value={motivoMovimento}
              onChange={(e) => setMotivoMovimento(e.target.value)}
              placeholder="Motivo"
              className="flex-1 rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
            <button
              type="submit"
              disabled={registrandoMovimento}
              className="rounded-lg border border-rose px-4 py-2 text-sm font-semibold text-rose-deep disabled:opacity-60"
            >
              {registrandoMovimento ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </form>
        {erroMovimento && <p className="mt-2 text-xs font-medium text-crit">{erroMovimento}</p>}

        {movimentosHoje.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            {movimentosHoje.map((m) => (
              <li key={m.id} className="flex justify-between text-xs text-text-soft">
                <span>
                  {formatarDataHoraIso(m.criado_em)} — {m.motivo}
                </span>
                <span className={`font-semibold tabular-nums ${m.tipo === "entrada" ? "text-ok" : "text-ink"}`}>
                  {m.tipo === "entrada" ? "+" : "−"} {formatarMoeda(m.valor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={handleFecharCaixa}
        disabled={fechando}
        className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-3 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
      >
        {fechando ? (statusImpressao === "imprimindo" ? "Imprimindo…" : "Fechando…") : "🖨️ Fechar caixa e imprimir"}
      </button>

      {statusImpressao === "impresso" && (
        <p className="text-center text-sm font-semibold text-ok">✓ Caixa fechado e resumo impresso.</p>
      )}
      {erroFechamento && (
        <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-center text-sm font-medium text-crit">
          {erroFechamento}
        </p>
      )}
    </div>
  );
}
