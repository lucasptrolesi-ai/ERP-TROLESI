"use client";

import { useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { calcularPrecoPorCotacao } from "@/lib/precificacao";
import { entradaOuroEvento } from "@/lib/actions/pdv-eventos";
import { hojeIso } from "@/lib/datas";
import type { ProdutoEvento } from "@/lib/types";

// Fixo em 1,30 (30% de acréscimo, pedido exato do usuário 2026-09-01) —
// diferente do Estoque real, que usa produtos.multiplicador por produto.
const MULTIPLICADOR_OURO_EVENTO = 1.3;

const CLASSE_INPUT =
  "rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft";
const CLASSE_LABEL = "text-xs font-semibold uppercase tracking-wide text-text-soft";

/** Entrada de peça de ouro (pedido direto do usuário, 2026-09-01): digita o
 * código, o preço sai sozinho — peso × cotação do dia (tela "Cotação",
 * material "Ouro") × 1,30. Código já cadastrado reaproveita o peso salvo
 * (só confirma quantidade); código novo pede nome + peso uma única vez —
 * da próxima entrada em diante, o peso já vem sozinho. */
export function EntradaOuroModal({
  aberto,
  onFechar,
  produtosEvento,
  cotacaoOuroHoje,
}: {
  aberto: boolean;
  onFechar: () => void;
  produtosEvento: ProdutoEvento[];
  cotacaoOuroHoje: number | null;
}) {
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [peso, setPeso] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  const codigoNormalizado = codigo.trim().toUpperCase();
  const encontrado = useMemo(
    () => produtosEvento.find((p) => p.codigo_interno.trim().toUpperCase() === codigoNormalizado) ?? null,
    [produtosEvento, codigoNormalizado],
  );

  // Peça já cadastrada: peso vem pré-preenchido (mas editável, pra corrigir
  // se pesou errado). Peça nova: peso começa em branco, obrigatório.
  const pesoExibido = peso || (encontrado?.peso != null ? String(encontrado.peso) : "");
  const pesoNumero = Number(pesoExibido.replace(",", "."));
  const quantidadeNumero = Math.max(0, Math.trunc(Number(quantidade) || 0));

  const precoCalculado =
    cotacaoOuroHoje != null && Number.isFinite(pesoNumero) && pesoNumero > 0
      ? calcularPrecoPorCotacao(pesoNumero, cotacaoOuroHoje, MULTIPLICADOR_OURO_EVENTO)
      : null;

  function limpar() {
    setCodigo("");
    setNome("");
    setPeso("");
    setQuantidade("1");
    setErro(null);
  }

  function fecharTudo() {
    limpar();
    setSucesso(null);
    onFechar();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);

    if (!codigoNormalizado) {
      setErro("Informe o código da peça.");
      return;
    }
    if (quantidadeNumero <= 0) {
      setErro("Quantidade precisa ser maior que zero.");
      return;
    }
    if (!encontrado && (!nome.trim() || !(pesoNumero > 0))) {
      setErro("Código novo: informe nome e peso (g).");
      return;
    }

    const nomeParaEnvio = encontrado ? null : nome.trim();
    const pesoParaEnvio = encontrado ? null : pesoNumero;
    const nomeParaMensagem = encontrado?.nome ?? nome.trim();

    iniciar(async () => {
      const resultado = await entradaOuroEvento(
        codigoNormalizado,
        quantidadeNumero,
        hojeIso(),
        nomeParaEnvio,
        pesoParaEnvio,
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setSucesso(
        `${quantidadeNumero}x "${nomeParaMensagem}" — preço atualizado pra ${
          precoCalculado != null ? formatarMoeda(precoCalculado) : "—"
        }.`,
      );
      limpar();
    });
  }

  return (
    <Modal aberto={aberto} onFechar={fecharTudo} titulo="🟡 Entrada de ouro">
      {cotacaoOuroHoje == null && (
        <p className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm font-medium text-warn">
          Cotação do ouro de hoje ainda não foi informada — abra &quot;Cotação&quot; no menu antes de continuar.
        </p>
      )}
      {sucesso && <p className="mb-3 rounded-lg bg-ok-bg px-3 py-2 text-sm font-medium text-ok">{sucesso}</p>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="codigo-ouro" className={CLASSE_LABEL}>
            Código da peça
          </label>
          <input
            id="codigo-ouro"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            autoFocus
            className={CLASSE_INPUT}
          />
          {codigoNormalizado && (
            <p className="text-xs text-text-soft">
              {encontrado ? `Peça já cadastrada: "${encontrado.nome}".` : "Código novo — vai cadastrar uma peça nova."}
            </p>
          )}
        </div>

        {!encontrado && codigoNormalizado && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nome-ouro" className={CLASSE_LABEL}>
              Nome da peça
            </label>
            <input
              id="nome-ouro"
              value={nome}
              onChange={(e) => setNome(e.target.value.toUpperCase())}
              className={CLASSE_INPUT}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="peso-ouro" className={CLASSE_LABEL}>
              Peso (g)
            </label>
            <input
              id="peso-ouro"
              value={pesoExibido}
              onChange={(e) => setPeso(e.target.value)}
              inputMode="decimal"
              className={CLASSE_INPUT}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quantidade-ouro" className={CLASSE_LABEL}>
              Quantidade
            </label>
            <input
              id="quantidade-ouro"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              inputMode="numeric"
              className={CLASSE_INPUT}
            />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-cream p-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">Preço calculado</p>
          <p className="font-display text-2xl font-semibold text-rose-deep">
            {precoCalculado != null ? formatarMoeda(precoCalculado) : "—"}
          </p>
          {cotacaoOuroHoje != null && (
            <p className="text-xs text-text-soft">
              {pesoExibido || "0"}g × {formatarMoeda(cotacaoOuroHoje)} × 1,30
            </p>
          )}
        </div>

        {erro && <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">{erro}</p>}

        <button
          type="submit"
          disabled={enviando || cotacaoOuroHoje == null}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
        >
          {enviando ? "Salvando…" : "Confirmar entrada"}
        </button>
      </form>
    </Modal>
  );
}
