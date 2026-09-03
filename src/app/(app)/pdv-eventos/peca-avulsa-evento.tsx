"use client";

import { useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { calcularPrecoUnitario } from "@/lib/precificacao";

const CLASSE_INPUT =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft";

/** Venda de peça não cadastrada no PDV Eventos (pedido do usuário,
 * 2026-09-03): "brinco de aço", digita código × multiplicador — mesma
 * fórmula do Pedidos real (calcularPrecoUnitario, precificacao.ts) — e o
 * sistema calcula o preço na hora. Entra na venda sem existir em
 * produtos_evento (sem baixa de estoque, ver criar_venda_evento). */
export function PecaAvulsaEvento({
  onAdicionar,
}: {
  onAdicionar: (item: { nome: string; preco: number }) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [multiplicador, setMultiplicador] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const codigoNumero = Number(codigo.replace(",", "."));
  const multiplicadorNumero = Number(multiplicador.replace(",", "."));
  const precoCalculado =
    codigo.trim() !== "" &&
    multiplicador.trim() !== "" &&
    Number.isFinite(codigoNumero) &&
    Number.isFinite(multiplicadorNumero)
      ? calcularPrecoUnitario(codigoNumero, multiplicadorNumero)
      : null;

  function limpar() {
    setNome("");
    setCodigo("");
    setMultiplicador("");
    setErro(null);
  }

  function adicionar() {
    if (!nome.trim()) {
      setErro("Informe o nome da peça.");
      return;
    }
    if (precoCalculado === null) {
      setErro("Informe código e multiplicador.");
      return;
    }
    onAdicionar({ nome: nome.trim().toUpperCase(), preco: precoCalculado });
    limpar();
    setAberta(false);
  }

  if (!aberta) {
    return (
      <button
        type="button"
        onClick={() => setAberta(true)}
        className="self-start rounded-full border border-rose-soft px-3 py-1.5 text-xs font-semibold text-rose-deep transition hover:bg-rose-soft"
      >
        ➕ Peça não cadastrada
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-cream/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">Peça não cadastrada</p>
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value.toUpperCase())}
        placeholder="Nome (ex: BRINCO DE AÇO)"
        autoFocus
        className={CLASSE_INPUT}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código"
          inputMode="decimal"
          className={CLASSE_INPUT}
        />
        <input
          value={multiplicador}
          onChange={(e) => setMultiplicador(e.target.value)}
          placeholder="Multiplicador"
          inputMode="decimal"
          className={CLASSE_INPUT}
        />
      </div>
      <p className="text-sm font-semibold text-ink">
        Preço: {precoCalculado != null ? formatarMoeda(precoCalculado) : "—"}
      </p>
      {erro && <p className="text-xs font-medium text-crit">{erro}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            limpar();
            setAberta(false);
          }}
          className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-text-soft"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={adicionar}
          className="flex-1 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-3 py-1.5 text-xs font-semibold text-gold-ink"
        >
          Adicionar à venda
        </button>
      </div>
    </div>
  );
}
