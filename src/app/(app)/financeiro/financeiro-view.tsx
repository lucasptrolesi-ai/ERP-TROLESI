"use client";

import { useMemo, useState, useTransition } from "react";
import { ContaPagarForm } from "@/components/conta-pagar-form";
import { BaixaContaModal } from "@/components/baixa-conta-modal";
import {
  darBaixaContaReceber,
  desfazerBaixaContaReceber,
  darBaixaEmLoteContasReceber,
  darBaixaContaPagar,
  desfazerBaixaContaPagar,
} from "@/lib/actions/financeiro";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { hojeIso, isoEmDias, formatarDataIso } from "@/lib/datas";
import type { ContaPagar, ContaReceberFinanceiro, FormaPagamento, Fornecedor, SituacaoConta } from "@/lib/types";

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

const FILTROS: readonly [SituacaoConta | "todos", string][] = [
  ["todos", "Todos"],
  ["atrasado", "Atrasados"],
  ["em_dia", "Em dia"],
  ["pago", "Pagos"],
];

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
  const [filtroSituacao, setFiltroSituacao] = useState<SituacaoConta | "todos">("todos");
  const [contaPagarEditando, setContaPagarEditando] = useState<ContaPagar | null | undefined>(undefined);
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set());
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [baixaReceberAberta, setBaixaReceberAberta] = useState<ContaReceberFinanceiro | null>(null);
  const [baixaLoteAberta, setBaixaLoteAberta] = useState(false);
  const [baixaPagarAberta, setBaixaPagarAberta] = useState<ContaPagar | null>(null);

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
    return contasReceber.filter((c) => {
      if (termo && !(c.clientes?.nome ?? "").toLowerCase().includes(termo)) return false;
      if (filtroSituacao !== "todos" && situacaoEfetiva(c.situacao, c.vencimento) !== filtroSituacao) return false;
      return true;
    });
  }, [contasReceber, busca, filtroSituacao]);

  const gruposPorCliente = useMemo(() => {
    const mapa = new Map<string, { clienteId: string; nome: string; itens: ContaReceberFinanceiro[] }>();
    for (const c of contasReceberFiltradas) {
      const chave = c.cliente_id ?? "sem-cliente";
      if (!mapa.has(chave)) mapa.set(chave, { clienteId: chave, nome: c.clientes?.nome ?? "—", itens: [] });
      mapa.get(chave)!.itens.push(c);
    }
    const grupos = Array.from(mapa.values());
    for (const g of grupos) {
      g.itens.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
    }
    grupos.sort((a, b) => {
      const chave = (g: (typeof grupos)[number]) =>
        g.itens.find((i) => i.situacao !== "pago")?.vencimento ?? g.itens[0]?.vencimento ?? "9999-99-99";
      const va = chave(a);
      const vb = chave(b);
      return va < vb ? -1 : va > vb ? 1 : 0;
    });
    return grupos;
  }, [contasReceberFiltradas]);

  const contasPagarFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contasPagar;
    return contasPagar.filter(
      (c) =>
        c.descricao.toLowerCase().includes(termo) || (c.fornecedores?.nome ?? "").toLowerCase().includes(termo),
    );
  }, [contasPagar, busca]);

  function alternarGrupo(clienteId: string) {
    setGruposAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(clienteId)) novo.delete(clienteId);
      else novo.add(clienteId);
      return novo;
    });
  }

  function alternarSelecao(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function selecionarVarios(ids: string[], marcar: boolean) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) {
        if (marcar) novo.add(id);
        else novo.delete(id);
      }
      return novo;
    });
  }

  const idsSelecionadosValidos = useMemo(
    () => Array.from(selecionados).filter((id) => contasReceber.some((c) => c.id === id && c.situacao !== "pago")),
    [selecionados, contasReceber],
  );

  const idsAbertosVisiveis = useMemo(
    () => contasReceberFiltradas.filter((c) => c.situacao !== "pago").map((c) => c.id),
    [contasReceberFiltradas],
  );
  const todosVisiveisSelecionados =
    idsAbertosVisiveis.length > 0 && idsAbertosVisiveis.every((id) => selecionados.has(id));

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
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 sm:px-5">
            <div className="flex items-center gap-2">
              {FILTROS.map(([valor, rotulo]) => (
                <button
                  key={valor}
                  onClick={() => setFiltroSituacao(valor)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filtroSituacao === valor
                      ? "border-rose bg-rose-soft text-rose-deep"
                      : "border-line bg-surface text-text-soft"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            {idsAbertosVisiveis.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-text-soft">
                <input
                  type="checkbox"
                  checked={todosVisiveisSelecionados}
                  onChange={() => selecionarVarios(idsAbertosVisiveis, !todosVisiveisSelecionados)}
                  className="h-4 w-4 accent-rose"
                />
                Selecionar todos ({idsAbertosVisiveis.length})
              </label>
            )}
          </div>
        )}

        {aba === "receber" && idsSelecionadosValidos.length > 0 && (
          <div className="mx-4 mb-3 flex items-center justify-between rounded-lg bg-rose-soft px-4 py-2.5 sm:mx-5">
            <span className="text-sm font-semibold text-rose-deep">
              {idsSelecionadosValidos.length} selecionado(s)
            </span>
            <div className="flex gap-3">
              <button
                onClick={() => setSelecionados(new Set())}
                className="text-xs font-semibold text-text-soft hover:underline"
              >
                Cancelar seleção
              </button>
              <button
                onClick={() => setBaixaLoteAberta(true)}
                className="rounded-full bg-gradient-to-br from-rose to-rose-deep px-3 py-1.5 text-xs font-semibold text-white"
              >
                Dar baixa em lote
              </button>
            </div>
          </div>
        )}

        {aba === "receber" && (
          <div className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
            {gruposPorCliente.map((grupo) => {
              const abertos = grupo.itens.filter((i) => i.situacao !== "pago");
              const totalAberto = abertos.reduce((s, i) => s + i.valor, 0);
              const expandido = gruposAbertos.has(grupo.clienteId);
              const idsAbertosGrupo = abertos.map((i) => i.id);
              const grupoTodoSelecionado = idsAbertosGrupo.length > 0 && idsAbertosGrupo.every((id) => selecionados.has(id));
              return (
                <div key={grupo.clienteId} className="rounded-lg border border-line">
                  <div className="flex w-full items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      {idsAbertosGrupo.length > 0 && (
                        <input
                          type="checkbox"
                          checked={grupoTodoSelecionado}
                          onChange={() => selecionarVarios(idsAbertosGrupo, !grupoTodoSelecionado)}
                          className="h-4 w-4 accent-rose"
                        />
                      )}
                      <button
                        onClick={() => alternarGrupo(grupo.clienteId)}
                        className="flex items-center gap-2 text-left"
                      >
                        <span className={`text-xs transition-transform ${expandido ? "rotate-90" : ""}`}>▶</span>
                        <span className="text-sm font-semibold text-ink">{grupo.nome}</span>
                      </button>
                    </div>
                    <button
                      onClick={() => alternarGrupo(grupo.clienteId)}
                      className="flex items-center gap-3 text-xs text-text-soft"
                    >
                      {abertos.length > 0 ? (
                        <span>
                          <span className="font-semibold text-crit">{formatarMoeda(totalAberto)}</span> em aberto ·{" "}
                          {abertos.length} de {grupo.itens.length} título(s)
                        </span>
                      ) : (
                        <span>{grupo.itens.length} título(s), tudo pago</span>
                      )}
                    </button>
                  </div>

                  {expandido && (
                    <div className="overflow-x-auto border-t border-line">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                            <th className="px-4 py-2" />
                            <th className="px-2 py-2">Pedido</th>
                            <th className="px-2 py-2">Vencimento</th>
                            <th className="px-2 py-2">Valor</th>
                            <th className="px-2 py-2">Forma</th>
                            <th className="px-2 py-2">Situação</th>
                            <th className="px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {grupo.itens.map((c) => (
                            <tr key={c.id} className="border-t border-line align-top">
                              <td className="px-4 py-2.5">
                                {c.situacao !== "pago" && (
                                  <input
                                    type="checkbox"
                                    checked={selecionados.has(c.id)}
                                    onChange={() => alternarSelecao(c.id)}
                                    className="h-4 w-4 accent-rose"
                                  />
                                )}
                              </td>
                              <td className="px-2 py-2.5">
                                {c.pedidos ? `#${c.pedidos.numero}` : "—"}
                                {c.total_parcelas && c.total_parcelas > 1 ? ` (${c.numero_parcela}/${c.total_parcelas})` : ""}
                              </td>
                              <td className="px-2 py-2.5">{formatarDataIso(c.vencimento)}</td>
                              <td className="px-2 py-2.5 tabular-nums">{formatarMoeda(c.valor)}</td>
                              <td className="px-2 py-2.5">{c.forma_pagamento ? FORMA_LABEL[c.forma_pagamento] : "—"}</td>
                              <td className="px-2 py-2.5">
                                <SituacaoPill situacao={situacaoEfetiva(c.situacao, c.vencimento)} />
                                {c.situacao === "pago" && c.pago_em && (
                                  <ResumoBaixa
                                    pagoEm={c.pago_em}
                                    formaPagamentoBaixa={c.forma_pagamento_baixa}
                                    valorPago={c.valor_pago}
                                    valorOriginal={c.valor}
                                    observacao={c.observacao_baixa}
                                  />
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <AcaoBaixa
                                  pago={c.situacao === "pago"}
                                  onDarBaixa={() => setBaixaReceberAberta(c)}
                                  onDesfazer={() => desfazerBaixaContaReceber(c.id)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {gruposPorCliente.length === 0 && (
              <p className="py-8 text-center text-sm text-text-soft">Nenhuma conta a receber encontrada.</p>
            )}
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
                  <tr key={c.id} className="border-t border-line align-top">
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
                      {c.situacao === "pago" && c.pago_em && (
                        <ResumoBaixa pagoEm={c.pago_em} formaPagamentoBaixa={c.forma_pagamento_baixa} />
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <AcaoBaixa
                        pago={c.situacao === "pago"}
                        onDarBaixa={() => setBaixaPagarAberta(c)}
                        onDesfazer={() => desfazerBaixaContaPagar(c.id)}
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

      {baixaReceberAberta && (
        <BaixaContaModal
          aberto
          onFechar={() => setBaixaReceberAberta(null)}
          titulo={`Dar baixa — ${baixaReceberAberta.clientes?.nome ?? "cliente"}`}
          valorSugerido={baixaReceberAberta.valor}
          modo="individual"
          aoConfirmar={(dados) => darBaixaContaReceber(baixaReceberAberta.id, dados)}
        />
      )}

      {baixaLoteAberta && (
        <BaixaContaModal
          aberto
          onFechar={() => {
            setBaixaLoteAberta(false);
            setSelecionados(new Set());
          }}
          titulo={`Dar baixa em lote — ${idsSelecionadosValidos.length} título(s)`}
          modo="lote"
          aoConfirmar={(dados) => darBaixaEmLoteContasReceber(idsSelecionadosValidos, dados)}
        />
      )}

      {baixaPagarAberta && (
        <BaixaContaModal
          aberto
          onFechar={() => setBaixaPagarAberta(null)}
          titulo={`Dar baixa — ${baixaPagarAberta.descricao}`}
          valorSugerido={baixaPagarAberta.valor}
          modo="individual"
          aoConfirmar={(dados) => darBaixaContaPagar(baixaPagarAberta.id, dados)}
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

function ResumoBaixa({
  pagoEm,
  formaPagamentoBaixa,
  valorPago,
  valorOriginal,
  observacao,
}: {
  pagoEm: string;
  formaPagamentoBaixa: FormaPagamento | null;
  valorPago?: number | null;
  valorOriginal?: number;
  observacao?: string | null;
}) {
  return (
    <p className="mt-1 text-[0.7rem] text-text-soft">
      {formatarDataIso(pagoEm)}
      {formaPagamentoBaixa ? ` · ${FORMA_LABEL[formaPagamentoBaixa]}` : ""}
      {valorPago != null && valorOriginal != null && valorPago !== valorOriginal
        ? ` · ${formatarMoeda(valorPago)}`
        : ""}
      {observacao ? ` · ${observacao}` : ""}
    </p>
  );
}

function AcaoBaixa({
  pago,
  onDarBaixa,
  onDesfazer,
}: {
  pago: boolean;
  onDarBaixa: () => void;
  onDesfazer: () => Promise<{ erro?: string }>;
}) {
  if (pago) return <BotaoDesfazer onDesfazer={onDesfazer} />;
  return (
    <button onClick={onDarBaixa} className="text-xs font-semibold text-rose-deep hover:underline">
      Dar baixa
    </button>
  );
}

function BotaoDesfazer({ onDesfazer }: { onDesfazer: () => Promise<{ erro?: string }> }) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function desfazer() {
    setErro(null);
    iniciar(async () => {
      const resultado = await onDesfazer();
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={desfazer}
        disabled={pendente}
        className="text-xs font-semibold text-text-soft hover:underline disabled:opacity-60"
      >
        {pendente ? "Salvando…" : "Desfazer baixa"}
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
