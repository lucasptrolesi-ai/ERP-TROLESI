"use client";

import { useMemo, useState, useTransition } from "react";
import { converterEmCrediario, lancarCrediario, receberCrediario } from "@/lib/actions/crediario";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso, hojeIso } from "@/lib/datas";
import { crediarioBloqueadoPorAtraso, situacaoEfetiva } from "@/lib/situacao-conta";
import type { Cliente, CrediarioLancamento, SituacaoConta } from "@/lib/types";

const SITUACAO_LABEL: Record<string, { rotulo: string; classe: string }> = {
  em_dia: { rotulo: "Em dia", classe: "bg-ok-bg text-ok" },
  atrasado: { rotulo: "Atrasado", classe: "bg-crit-bg text-crit" },
  pago: { rotulo: "Pago", classe: "bg-line text-text-soft" },
};

export function CrediarioView({ clientes, lancamentos }: { clientes: Cliente[]; lancamentos: CrediarioLancamento[] }) {
  const clientesCrediario = useMemo(() => clientes.filter((c) => c.crediario_legado), [clientes]);
  const clientesElegiveis = useMemo(() => clientes.filter((c) => !c.crediario_legado), [clientes]);

  // Bloqueio por atraso (seção 15, decisão registrada em pending_decisions):
  // atraso > 5 dias em qualquer lançamento não pago bloqueia o cliente —
  // calculado na hora a partir dos lançamentos, nunca lido de uma flag
  // armazenada (que ficaria desatualizada, mesmo erro já corrigido em
  // contas_receber/pagar).
  const bloqueadoPorCliente = useMemo(() => {
    const mapa = new Map<string, boolean>();
    for (const c of clientesCrediario) {
      const doCliente = lancamentos
        .filter((l) => l.cliente_id === c.id)
        .map((l) => ({ situacao: l.situacao as SituacaoConta, vencimento: l.vencimento }));
      mapa.set(c.id, crediarioBloqueadoPorAtraso(doCliente));
    }
    return mapa;
  }, [clientesCrediario, lancamentos]);

  const [clienteConversao, setClienteConversao] = useState("");
  const [limite, setLimite] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [erroConversao, setErroConversao] = useState<string | null>(null);
  const [convertendo, iniciarConversao] = useTransition();

  const [clienteLancamento, setClienteLancamento] = useState("");
  const [valorLancamento, setValorLancamento] = useState("");
  const [vencimentoLancamento, setVencimentoLancamento] = useState(hojeIso());
  const [erroLancamento, setErroLancamento] = useState<string | null>(null);
  const [lancando, iniciarLancamento] = useTransition();

  function converter() {
    setErroConversao(null);
    if (!clienteConversao) {
      setErroConversao("Selecione um cliente.");
      return;
    }
    iniciarConversao(async () => {
      const resultado = await converterEmCrediario(clienteConversao, Number(limite.replace(",", ".")) || 0, justificativa);
      if (resultado.erro) setErroConversao(resultado.erro);
      else {
        setClienteConversao("");
        setLimite("");
        setJustificativa("");
      }
    });
  }

  function lancar() {
    setErroLancamento(null);
    if (!clienteLancamento) {
      setErroLancamento("Selecione um cliente.");
      return;
    }
    iniciarLancamento(async () => {
      const resultado = await lancarCrediario(
        clienteLancamento,
        Number(valorLancamento.replace(",", ".")) || 0,
        vencimentoLancamento,
      );
      if (resultado.erro) setErroLancamento(resultado.erro);
      else {
        setValorLancamento("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">
          Converter cliente em crediário legado
        </h2>
        <p className="mb-3 text-xs text-text-soft">
          Não se abrem crediários novos, exceto clientes legados já autorizados (seção 15). Só admin converte, com
          justificativa obrigatória e registro em auditoria.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={clienteConversao}
            onChange={(e) => setClienteConversao(e.target.value)}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          >
            <option value="">Cliente…</option>
            {clientesElegiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <input
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            placeholder="Limite (R$)"
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          />
          <input
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Justificativa"
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          />
        </div>
        {erroConversao && <p className="mt-2 text-sm font-medium text-crit">{erroConversao}</p>}
        <button
          type="button"
          disabled={convertendo}
          onClick={converter}
          className="mt-3 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
        >
          {convertendo ? "Convertendo…" : "Converter em crediário"}
        </button>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Clientes com crediário legado</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Limite</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Autorizado em</th>
              </tr>
            </thead>
            <tbody>
              {clientesCrediario.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2">{c.nome}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.crediario_limite != null ? formatarMoeda(c.crediario_limite) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {bloqueadoPorCliente.get(c.id) ? (
                      <span className="rounded-full bg-crit-bg px-2.5 py-1 text-xs font-bold text-crit">
                        Bloqueado (atraso &gt; 5 dias)
                      </span>
                    ) : (
                      c.crediario_status
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {c.crediario_autorizado_em ? formatarDataIso(c.crediario_autorizado_em) : "—"}
                  </td>
                </tr>
              ))}
              {clientesCrediario.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-text-soft">
                    Nenhum cliente convertido ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Novo lançamento</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={clienteLancamento}
            onChange={(e) => setClienteLancamento(e.target.value)}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          >
            <option value="">Cliente (crediário)…</option>
            {clientesCrediario.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <input
            value={valorLancamento}
            onChange={(e) => setValorLancamento(e.target.value)}
            placeholder="Valor (R$)"
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          />
          <input
            type="date"
            value={vencimentoLancamento}
            onChange={(e) => setVencimentoLancamento(e.target.value)}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          />
        </div>
        {erroLancamento && <p className="mt-2 text-sm font-medium text-crit">{erroLancamento}</p>}
        <button
          type="button"
          disabled={lancando}
          onClick={lancar}
          className="mt-3 rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {lancando ? "Lançando…" : "Lançar"}
        </button>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Cliente</th>
                <th className="px-5 py-2">Valor</th>
                <th className="px-5 py-2">Vencimento</th>
                <th className="px-5 py-2">Situação</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {lancamentos.map((l) => (
                <LinhaLancamento key={l.id} lancamento={l} />
              ))}
              {lancamentos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhum lançamento de crediário ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LinhaLancamento({ lancamento: l }: { lancamento: CrediarioLancamento }) {
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  // "atrasado" nunca é gravado no banco — é sempre calculado na hora
  // comparando vencimento com hoje (mesmo padrão de contas_receber/pagar,
  // situacaoEfetiva), senão uma cobrança vencida ficava mostrando "Em dia"
  // pra sempre até ser paga.
  const situacaoCalculada = situacaoEfetiva(l.situacao as SituacaoConta, l.vencimento);
  const situacao = SITUACAO_LABEL[situacaoCalculada] ?? { rotulo: situacaoCalculada, classe: "bg-line text-text-soft" };

  function receber() {
    const recibo = prompt("Nº do recibo (recebimento só em dinheiro entregue em mãos, seção 15):");
    if (recibo === null) return;
    setErro(null);
    iniciar(async () => {
      const resultado = await receberCrediario(l.id, recibo || undefined);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <tr className="border-t border-line">
      <td className="px-5 py-2.5">{l.clientes?.nome ?? "—"}</td>
      <td className="px-5 py-2.5 tabular-nums">{formatarMoeda(l.valor)}</td>
      <td className="px-5 py-2.5">{formatarDataIso(l.vencimento)}</td>
      <td className="px-5 py-2.5">
        <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${situacao.classe}`}>
          {situacao.rotulo}
        </span>
        {erro && <p className="mt-1 text-xs font-medium text-crit">{erro}</p>}
      </td>
      <td className="px-5 py-2.5 text-right">
        {l.situacao !== "pago" && (
          <button
            type="button"
            disabled={pending}
            onClick={receber}
            className="rounded-full border border-ok px-3 py-1 text-xs font-semibold text-ok disabled:opacity-60"
          >
            Receber
          </button>
        )}
      </td>
    </tr>
  );
}
