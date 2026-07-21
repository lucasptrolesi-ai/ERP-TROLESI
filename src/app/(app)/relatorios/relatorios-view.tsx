"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import {
  deslocarPeriodo,
  dentroDoPeriodo,
  faturamentoTotal,
  limitesPeriodo,
  pedidosNoPeriodo,
  periodoAnterior,
  quebraPorFormaPagamento,
  variacaoPercentual,
  type PedidoRelatorio,
  type TipoPeriodo,
} from "@/lib/relatorios";
import { dataLocalDoTimestamptz, hojeIso } from "@/lib/datas";
import { situacaoEfetiva } from "@/lib/situacao-conta";
import type { Abatimento, Cliente, CrediarioLancamento, Expedicao, Garantia, Produto, SituacaoConta } from "@/lib/types";

type PedidoComCliente = PedidoRelatorio & { cliente_id: string | null };
type ComissaoRelatorio = { valor_comissao: number; criado_em: string };

const PERIODOS: { valor: TipoPeriodo; rotulo: string }[] = [
  { valor: "dia", rotulo: "Diário" },
  { valor: "semana", rotulo: "Semanal" },
  { valor: "mes", rotulo: "Mensal" },
];

export function RelatoriosView({
  pedidos,
  abatimentos,
  garantias,
  produtos,
  crediarioLancamentos,
  expedicoes,
  comissoes,
  clientes,
}: {
  pedidos: PedidoComCliente[];
  abatimentos: Abatimento[];
  garantias: Garantia[];
  produtos: Produto[];
  crediarioLancamentos: CrediarioLancamento[];
  expedicoes: Expedicao[];
  comissoes: ComissaoRelatorio[];
  clientes: Cliente[];
}) {
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>("mes");
  const [referencia, setReferencia] = useState(hojeIso());

  const { inicio, fim } = limitesPeriodo(tipoPeriodo, referencia);
  const anterior = periodoAnterior(tipoPeriodo, referencia);

  const pedidosPeriodo = useMemo(() => pedidosNoPeriodo(pedidos, inicio, fim), [pedidos, inicio, fim]);
  const pedidosAnterior = useMemo(
    () => pedidosNoPeriodo(pedidos, anterior.inicio, anterior.fim),
    [pedidos, anterior],
  );

  const faturamento = faturamentoTotal(pedidosPeriodo);
  const faturamentoAnterior = faturamentoTotal(pedidosAnterior);
  const variacao = variacaoPercentual(faturamento, faturamentoAnterior);

  const vendasFaturadas = pedidosPeriodo.filter((p) => p.status === "faturado" || p.status === "aguardando_lancamento_gmax" || p.status === "lancado_gmax");
  const cancelamentos = pedidosPeriodo.filter((p) => p.status === "cancelado").length;
  const ticketMedio = vendasFaturadas.length > 0 ? faturamento / vendasFaturadas.length : 0;
  const quebraForma = quebraPorFormaPagamento(pedidosPeriodo);

  // criado_em é timestamptz (UTC) — comparar a string direto contra
  // "inicio"/"fim" (datas locais de Brasília) já causou esse exato bug de
  // fuso antes neste projeto (rollover perto da meia-noite). Sempre passar
  // pelo mesmo dentroDoPeriodo()/dataLocalDoTimestamptz() que pedidosNoPeriodo
  // já usa, nunca comparação de string crua.
  const abatimentosPeriodo = abatimentos.filter((a) => dentroDoPeriodo(dataLocalDoTimestamptz(a.criado_em), inicio, fim));
  const abatimentosAprovados = abatimentosPeriodo.filter((a) => a.status === "aprovado");
  const abatimentosReprovados = abatimentosPeriodo.filter((a) => a.status === "reprovado");
  const valorAbatido = abatimentosAprovados.reduce((s, a) => s + (a.valor_atribuido ?? 0), 0);

  const garantiasPeriodo = garantias.filter((g) => dentroDoPeriodo(dataLocalDoTimestamptz(g.criado_em), inicio, fim));
  const garantiasAprovadas = garantiasPeriodo.filter((g) => g.aprovado === true).length;
  const garantiasReprovadas = garantiasPeriodo.filter((g) => g.aprovado === false).length;

  const estoqueBaixo = produtos.filter((p) => p.quantidade_estoque < p.estoque_minimo);

  // Primeira compra no período: entre as vendas do período, quantas são a
  // primeira venda de verdade (faturado/aguardando/lançado) daquele cliente
  // em toda a janela de histórico carregada (~13 meses), não só no período.
  const vendasValidas = pedidos.filter(
    (p) => p.status === "faturado" || p.status === "aguardando_lancamento_gmax" || p.status === "lancado_gmax",
  );
  const primeiraVendaPorCliente = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of vendasValidas) {
      if (!p.cliente_id) continue;
      const atual = mapa.get(p.cliente_id);
      if (!atual || p.criado_em < atual) mapa.set(p.cliente_id, p.criado_em);
    }
    return mapa;
  }, [vendasValidas]);
  const primeiraCompraNoPeriodo = vendasFaturadas.filter(
    (p) => p.cliente_id && primeiraVendaPorCliente.get(p.cliente_id) === p.criado_em,
  ).length;

  // Clientes inativos: sem nenhuma venda válida nos últimos 6 meses (visão
  // "hoje", independente do período navegado — não faz sentido "clientes
  // inativos da semana passada").
  const ultimaCompraPorCliente = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of vendasValidas) {
      if (!p.cliente_id) continue;
      const atual = mapa.get(p.cliente_id);
      if (!atual || p.criado_em > atual) mapa.set(p.cliente_id, p.criado_em);
    }
    return mapa;
  }, [vendasValidas]);
  const seiseMesesAtrasIso = (() => {
    const [ano, mes, dia] = hojeIso().split("-").map(Number);
    const data = new Date(ano, mes - 1 - 6, dia, 12);
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
  })();
  const clientesInativos = clientes.filter((c) => {
    const ultima = ultimaCompraPorCliente.get(c.id);
    return !ultima || dataLocalDoTimestamptz(ultima) < seiseMesesAtrasIso;
  }).length;

  const crediarioComSituacao = crediarioLancamentos.map((l) => ({
    ...l,
    situacaoCalculada: situacaoEfetiva(l.situacao as SituacaoConta, l.vencimento),
  }));
  const crediarioAtrasado = crediarioComSituacao.filter((l) => l.situacaoCalculada === "atrasado");
  const valorCrediarioAtrasado = crediarioAtrasado.reduce((s, l) => s + l.valor, 0);

  const fretesGratisPeriodo = expedicoes.filter(
    (e) => e.frete_gratis && dentroDoPeriodo(dataLocalDoTimestamptz(e.criado_em), inicio, fim),
  );

  const comissoesPeriodo = comissoes.filter((c) => dentroDoPeriodo(dataLocalDoTimestamptz(c.criado_em), inicio, fim));
  const totalComissoes = comissoesPeriodo.reduce((s, c) => s + c.valor_comissao, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              onClick={() => setTipoPeriodo(p.valor)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
                tipoPeriodo === p.valor ? "border-rose bg-rose-soft text-rose-deep" : "border-line text-text-soft"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReferencia(deslocarPeriodo(tipoPeriodo, referencia, -1))}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-ink"
          >
            ◀
          </button>
          <span className="text-sm text-text-soft">
            {inicio === fim ? inicio : `${inicio} — ${fim}`}
          </span>
          <button
            onClick={() => setReferencia(deslocarPeriodo(tipoPeriodo, referencia, 1))}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-ink"
          >
            ▶
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Faturamento"
          valor={formatarMoeda(faturamento)}
          nota={variacao !== null ? `${variacao >= 0 ? "+" : ""}${variacao.toFixed(1)}% vs. período anterior` : "sem período anterior"}
        />
        <KpiCard label="Vendas" valor={String(vendasFaturadas.length)} nota="pedidos faturados/registrados" />
        <KpiCard label="Ticket médio" valor={formatarMoeda(ticketMedio)} nota="por venda" />
        <KpiCard label="Cancelamentos" valor={String(cancelamentos)} nota="pedidos extornados" tom={cancelamentos > 0 ? "warn" : "ok"} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Primeira compra" valor={String(primeiraCompraNoPeriodo)} nota="clientes novos no período" />
        <KpiCard
          label="Clientes inativos"
          valor={String(clientesInativos)}
          nota="sem compra há 6+ meses"
          tom={clientesInativos > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Crediário em atraso"
          valor={String(crediarioAtrasado.length)}
          nota={formatarMoeda(valorCrediarioAtrasado)}
          tom={crediarioAtrasado.length > 0 ? "crit" : "ok"}
        />
        <KpiCard label="Comissões do período" valor={formatarMoeda(totalComissoes)} nota={`${comissoesPeriodo.length} lançamento(s)`} />
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">Quebra por forma de pagamento</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(quebraForma).map(([forma, valor]) => (
            <div key={forma} className="rounded-lg border border-line bg-cream p-3">
              <p className="text-xs text-text-soft">{FORMA_LABEL[forma] ?? forma}</p>
              <p className="font-display text-lg font-semibold text-rose-deep tabular-nums">{formatarMoeda(valor ?? 0)}</p>
            </div>
          ))}
          {Object.keys(quebraForma).length === 0 && (
            <p className="text-sm text-text-soft">Nenhuma venda faturada no período.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-ink">Abatimentos</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-text-soft">Aprovados</p>
              <p className="font-display text-lg font-semibold text-ok">{abatimentosAprovados.length}</p>
            </div>
            <div>
              <p className="text-text-soft">Reprovados</p>
              <p className="font-display text-lg font-semibold text-crit">{abatimentosReprovados.length}</p>
            </div>
            <div>
              <p className="text-text-soft">Valor abatido</p>
              <p className="font-display text-lg font-semibold text-rose-deep tabular-nums">{formatarMoeda(valorAbatido)}</p>
            </div>
          </div>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-ink">Garantias</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-text-soft">Aprovadas</p>
              <p className="font-display text-lg font-semibold text-ok">{garantiasAprovadas}</p>
            </div>
            <div>
              <p className="text-text-soft">Reprovadas</p>
              <p className="font-display text-lg font-semibold text-crit">{garantiasReprovadas}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Fretes grátis no período ({fretesGratisPeriodo.length})
        </h2>
        <div className="flex flex-col gap-1 text-sm text-text-soft">
          {fretesGratisPeriodo.slice(0, 10).map((e) => (
            <p key={e.id}>
              Pedido #{e.pedidos?.numero ?? "—"} — {e.pedidos?.clientes?.nome ?? "—"}
              {e.motivo_frete_gratis ? ` (${e.motivo_frete_gratis})` : ""}
            </p>
          ))}
          {fretesGratisPeriodo.length === 0 && <p>Nenhum frete grátis concedido no período.</p>}
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Estoque abaixo do mínimo ({estoqueBaixo.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {estoqueBaixo.slice(0, 20).map((p) => (
            <span key={p.id} className="rounded-full bg-warn-bg px-3 py-1 text-xs font-semibold text-warn">
              {p.nome} ({p.quantidade_estoque}/{p.estoque_minimo})
            </span>
          ))}
          {estoqueBaixo.length === 0 && <p className="text-sm text-text-soft">Nenhum produto abaixo do mínimo.</p>}
        </div>
      </div>

      <p className="text-center text-xs text-text-soft">
        Único indicador da seção 24 ainda fora do escopo: taxas de cartão — o schema não modela custo de maquininha
        como dado consultável (só existe o simulador ad-hoc de juros na tela de venda), então fica registrado aqui
        como lacuna deliberada em vez de indicador construído.
      </p>
    </div>
  );
}
