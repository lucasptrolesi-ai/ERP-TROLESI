"use client";

import { useState, useTransition } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { abrirCaixa, fecharCaixa, registrarMovimentoCaixa } from "@/lib/actions/varejo";
import type { ResultadoFechamento, SessaoCaixa } from "@/lib/varejo/tipos";

export function CaixaVarejoView({
  sessao,
  caixas,
}: {
  sessao: SessaoCaixa | null;
  caixas: { id: string; nome: string }[];
}) {
  if (!sessao) return <AbrirCaixa caixas={caixas} />;
  return <CaixaAberto sessao={sessao} />;
}

function AbrirCaixa({ caixas }: { caixas: { id: string; nome: string }[] }) {
  const [caixaId, setCaixaId] = useState(caixas[0]?.id ?? "");
  const [fundoTexto, setFundoTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function abrir() {
    if (!caixaId) {
      setErro("Selecione um caixa.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await abrirCaixa(caixaId, fundoTexto || "0");
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 rounded-[14px] border border-line bg-surface p-6 shadow-sm">
      <p className="text-sm text-text-soft">
        Você só enxerga a sua própria sessão de caixa, aberta agora — sem histórico de sessões anteriores.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Caixa
        <select value={caixaId} onChange={(e) => setCaixaId(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2">
          {caixas.length === 0 && <option value="">Nenhum caixa disponível</option>}
          {caixas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Fundo de troco
        <input
          type="text"
          value={fundoTexto}
          onChange={(e) => setFundoTexto(e.target.value)}
          placeholder="R$ 0,00"
          className="rounded-lg border border-line bg-surface px-3 py-2"
        />
      </label>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <button
        type="button"
        onClick={abrir}
        disabled={pendente}
        className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2.5 font-semibold text-gold-ink disabled:opacity-60"
      >
        {pendente ? "Abrindo…" : "Abrir caixa"}
      </button>
    </div>
  );
}

function CaixaAberto({ sessao }: { sessao: SessaoCaixa }) {
  const [tipo, setTipo] = useState<"suprimento" | "sangria" | null>(null);
  const [valorTexto, setValorTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erroMovimento, setErroMovimento] = useState<string | null>(null);
  const [pendenteMovimento, iniciarMovimento] = useTransition();

  const [contadoTexto, setContadoTexto] = useState("");
  const [erroFechamento, setErroFechamento] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoFechamento | null>(null);
  const [pendenteFechamento, iniciarFechamento] = useTransition();

  function registrarMovimento() {
    if (!tipo) return;
    setErroMovimento(null);
    iniciarMovimento(async () => {
      const resposta = await registrarMovimentoCaixa(tipo, sessao.sessao_id, valorTexto, motivo);
      if (resposta.erro) {
        setErroMovimento(resposta.erro);
        return;
      }
      setTipo(null);
      setValorTexto("");
      setMotivo("");
    });
  }

  function fechar() {
    setErroFechamento(null);
    iniciarFechamento(async () => {
      const resposta = await fecharCaixa(sessao.sessao_id, contadoTexto);
      if (resposta.erro) {
        setErroFechamento(resposta.erro);
        return;
      }
      setResultado(resposta.resultado ?? null);
    });
  }

  if (resultado) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-2 rounded-[14px] border border-line bg-surface p-6 text-sm shadow-sm">
        <p className="font-semibold">Caixa fechado.</p>
        <div className="flex justify-between">
          <span className="text-text-soft">Informado</span>
          <span>{formatarMoeda(resultado.valor_informado)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-soft">Esperado</span>
          <span>{formatarMoeda(resultado.valor_esperado)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Divergência</span>
          <span className={resultado.divergencia === 0 ? "text-emerald-700" : "text-red-700"}>
            {resultado.divergencia > 0 ? "+" : ""}
            {formatarMoeda(resultado.divergencia)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 rounded-[14px] border border-line bg-surface p-6 shadow-sm">
      <div className="text-sm">
        <p className="font-semibold">{sessao.caixa_nome}</p>
        <p className="text-text-soft">Fundo de troco: {formatarMoeda(sessao.fundo_troco)}</p>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setTipo("suprimento")} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-semibold">
          Suprimento
        </button>
        <button type="button" onClick={() => setTipo("sangria")} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-semibold">
          Sangria
        </button>
      </div>

      {tipo && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-sm font-semibold">{tipo === "suprimento" ? "Suprimento" : "Sangria"}</p>
          <input
            type="text"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
            placeholder="Valor"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          {erroMovimento && <p className="text-sm text-red-700">{erroMovimento}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setTipo(null)} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm">
              Cancelar
            </button>
            <button
              type="button"
              onClick={registrarMovimento}
              disabled={pendenteMovimento}
              className="flex-1 rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-3 py-2 text-sm font-semibold text-gold-ink disabled:opacity-60"
            >
              {pendenteMovimento ? "Salvando…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-sm font-semibold">Fechar caixa</p>
        <p className="text-xs text-text-soft">Conte o dinheiro da gaveta e informe o valor — o esperado só aparece depois.</p>
        <input
          type="text"
          value={contadoTexto}
          onChange={(e) => setContadoTexto(e.target.value)}
          placeholder="Valor contado"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        {erroFechamento && <p className="text-sm text-red-700">{erroFechamento}</p>}
        <button
          type="button"
          onClick={fechar}
          disabled={pendenteFechamento}
          className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
        >
          {pendenteFechamento ? "Fechando…" : "Fechar caixa"}
        </button>
      </div>
    </div>
  );
}
