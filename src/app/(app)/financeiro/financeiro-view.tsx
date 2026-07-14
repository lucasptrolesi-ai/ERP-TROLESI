"use client";

import { useMemo, useState, useTransition } from "react";
import { ContaPagarForm } from "@/components/conta-pagar-form";
import { marcarContaReceberPaga, marcarContaPagarPaga } from "@/lib/actions/financeiro";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { hojeIso, isoEmDias, formatarDataIso } from "@/lib/datas";
import type { ContaPagar, ContaReceberFinanceiro, Fornecedor, SituacaoConta } from "@/lib/types";

/** situação guardada no banco não muda sozinha com o tempo — "atrasado" é
 * sempre calculado na hora, comparando vencimento com hoje, exceto quando
 * já foi baixada como paga (aí prevalece o que está no banco). */
function situacaoEfetiva(situacao: SituacaoConta, vencimento: string): SituacaoConta {
  if (situacao === "pago") return "pago";
  return vencimento < hojeIso() ? "atrasado" : "em_dia";
}

const SITUACAO_ESTILO: Record<SituacaoConta, { rotulo: string; classe: string }> = {
  em_dia: { rotulo: "Em dia", classe: "bg-ok-bg text-ok" },
  atrasado: { rotulo: "Atrasado", classe: "bg-crit-bg text-crit" },
  pago: { rotulo: "Pago", classe: "bg-line text-text-soft" },
};

function resumir(itens: { valor: number }[]) {
  return { total: itens.reduce((s, i) => s + i.valor, 0), qtd: itens.length };
}

type Aba = "receber" | "pagar";

export function FinanceiroView({
  contasReceber,
  contasPagar,
  fornecedores,
}: {
  contasReceber: ContaReceberFinanceiro[];
  contasPagar: ContaPagar[];
  fornecedores: Fornecedor[];
}) {
  const [aba, setAba] = useState<Aba>("receber");
  const [busca, setBusca] = useState("");
  const [contaPagarEditando, setContaPagarEditando] = useState<ContaPagar | null | undefined>(undefined);

  const limite30dias = isoEmDias(30);

  const kpis = useMemo(() => {
    const aReceber30 = contasReceber.filter(
      (c) => situacaoEfetiva(c.situacao, c.vencimento) !== "pago" && c.vencimento <= limite30dias,
    );
    const emAtraso = contasReceber.filter((c) => situacaoEfetiva(c.situacao, c.vencimento) === "atrasado");
    const aPagar30 = contasPagar.filter(
      (c) => situacaoEfetiva(c.situacao, c.vencimento) !== "pago" && c.vencimento <= limite30dias,
    );
    return { aReceber30: resumir(aReceber30), emAtraso: resumir(emAtraso), aPagar30: resumir(aPagar30) };
  }, [contasReceber, contasPagar, limite30dias]);

  const contasReceberFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contasReceber;
    return contasReceber.filter((c) => (c.clientes?.nome ?? "").toLowerCase().includes(termo));
  }, [contasReceber, busca]);

  const contasPagarFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contasPagar;
    return contasPagar.filter(
      (c) =>
        c.descricao.toLowerCase().includes(termo) || (c.fornecedores?.nome ?? "").toLowerCase().includes(termo),
    );
  }, [contasPagar, busca]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="A receber (30 dias)" valor={kpis.aReceber30.total} nota={`${kpis.aReceber30.qtd} parcela(s)`} />
        <KpiCard
          label="Recebíveis em atraso"
          valor={kpis.emAtraso.total}
          nota={`${kpis.emAtraso.qtd} parcela(s)`}
          tom="crit"
        />
        <KpiCard label="A pagar (30 dias)" valor={kpis.aPagar30.total} nota={`${kpis.aPagar30.qtd} conta(s)`} tom="warn" />
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-4 sm:px-5">
          <div className="flex gap-6">
            <button
              onClick={() => setAba("receber")}
              className={`border-b-2 py-3 text-sm font-semibold ${
                aba === "receber" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
              }`}
            >
              Contas a receber
            </button>
            <button
              onClick={() => setAba("pagar")}
              className={`border-b-2 py-3 text-sm font-semibold ${
                aba === "pagar" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
              }`}
            >
              Contas a pagar
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={aba === "receber" ? "Buscar por cliente" : "Buscar por descrição ou fornecedor"}
            className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
          />
          {aba === "pagar" && (
            <button
              onClick={() => setContaPagarEditando(null)}
              className="shrink-0 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2 text-sm font-semibold text-white"
            >
              + Nova conta a pagar
            </button>
          )}
        </div>

        {aba === "receber" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                  <th className="px-5 py-2">Cliente</th>
                  <th className="px-5 py-2">Pedido</th>
                  <th className="px-5 py-2">Vencimento</th>
                  <th className="px-5 py-2">Valor</th>
                  <th className="px-5 py-2">Forma</th>
                  <th className="px-5 py-2">Situação</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {contasReceberFiltradas.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-5 py-2.5">{c.clientes?.nome ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      {c.pedidos ? `#${c.pedidos.numero}` : "—"}
                      {c.total_parcelas && c.total_parcelas > 1 ? ` (${c.numero_parcela}/${c.total_parcelas})` : ""}
                    </td>
                    <td className="px-5 py-2.5">{formatarDataIso(c.vencimento)}</td>
                    <td className="px-5 py-2.5 tabular-nums">{formatarMoeda(c.valor)}</td>
                    <td className="px-5 py-2.5">{c.forma_pagamento ? FORMA_LABEL[c.forma_pagamento] : "—"}</td>
                    <td className="px-5 py-2.5">
                      <SituacaoPill situacao={situacaoEfetiva(c.situacao, c.vencimento)} />
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <BotaoBaixa
                        pago={c.situacao === "pago"}
                        onAlternar={(pago) => marcarContaReceberPaga(c.id, pago)}
                      />
                    </td>
                  </tr>
                ))}
                {contasReceberFiltradas.length === 0 && (
                  <LinhaVazia colSpan={7} texto="Nenhuma conta a receber encontrada." />
                )}
              </tbody>
            </table>
          </div>
        )}

        {aba === "pagar" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                  <th className="px-5 py-2">Descrição</th>
                  <th className="px-5 py-2">Fornecedor</th>
                  <th className="px-5 py-2">Vencimento</th>
                  <th className="px-5 py-2">Valor</th>
                  <th className="px-5 py-2">Situação</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {contasPagarFiltradas.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <button onClick={() => setContaPagarEditando(c)} className="text-left hover:underline">
                        {c.descricao}
                      </button>
                    </td>
                    <td className="px-5 py-2.5">{c.fornecedores?.nome ?? "—"}</td>
                    <td className="px-5 py-2.5">{formatarDataIso(c.vencimento)}</td>
                    <td className="px-5 py-2.5 tabular-nums">{formatarMoeda(c.valor)}</td>
                    <td className="px-5 py-2.5">
                      <SituacaoPill situacao={situacaoEfetiva(c.situacao, c.vencimento)} />
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <BotaoBaixa
                        pago={c.situacao === "pago"}
                        onAlternar={(pago) => marcarContaPagarPaga(c.id, pago)}
                      />
                    </td>
                  </tr>
                ))}
                {contasPagarFiltradas.length === 0 && (
                  <LinhaVazia colSpan={6} texto="Nenhuma conta a pagar encontrada." />
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {contaPagarEditando !== undefined && (
        <ContaPagarForm
          key={contaPagarEditando?.id ?? "nova-conta-pagar"}
          aberto
          onFechar={() => setContaPagarEditando(undefined)}
          contaPagar={contaPagarEditando}
          fornecedores={fornecedores}
        />
      )}
    </div>
  );
}

function KpiCard({
  label,
  valor,
  nota,
  tom = "rose",
}: {
  label: string;
  valor: number;
  nota: string;
  tom?: "rose" | "warn" | "crit";
}) {
  const corValor = tom === "crit" ? "text-crit" : tom === "warn" ? "text-warn" : "text-rose-deep";
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${corValor}`}>{formatarMoeda(valor)}</p>
      <p className="mt-0.5 text-xs text-text-soft">{nota}</p>
    </div>
  );
}

function SituacaoPill({ situacao }: { situacao: SituacaoConta }) {
  const estilo = SITUACAO_ESTILO[situacao];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold before:h-1.5 before:w-1.5 before:rounded-full before:bg-current ${estilo.classe}`}>
      {estilo.rotulo}
    </span>
  );
}

function BotaoBaixa({
  pago,
  onAlternar,
}: {
  pago: boolean;
  onAlternar: (pago: boolean) => Promise<{ erro?: string }>;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function alternar() {
    setErro(null);
    iniciar(async () => {
      const resultado = await onAlternar(!pago);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={alternar}
        disabled={pendente}
        className="text-xs font-semibold text-rose-deep hover:underline disabled:opacity-60"
      >
        {pendente ? "Salvando…" : pago ? "Desfazer baixa" : "Marcar como pago"}
      </button>
      {erro && <span className="text-[0.65rem] text-crit">{erro}</span>}
    </div>
  );
}

function LinhaVazia({ colSpan, texto }: { colSpan: number; texto: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-text-soft">
        {texto}
      </td>
    </tr>
  );
}
