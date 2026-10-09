"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { baixarTexto } from "@/lib/baixar-arquivo";
import { KpiCard } from "@/components/kpi-card";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import {
  apagarGasto,
  apagarInvestimentoInicial,
  apagarMembroEquipe,
  apagarMovimentoCaixa,
  apagarVendaManual,
  criarGasto,
  criarInvestimentoInicial,
  criarMembroEquipe,
  criarMovimentoCaixa,
  criarVendaManual,
  criarVigenciaConfig,
  editarGasto,
  editarInvestimentoInicial,
  editarMembroEquipe,
  editarMovimentoCaixa,
  editarVendaManual,
  importarControleAntigo,
  type DadosGasto,
  type DadosInvestimentoInicial,
  type DadosMembroEquipe,
  type DadosMovimentoCaixa,
  type DadosVendaManual,
} from "@/lib/actions/varejo-financeiro";
import type {
  ConfigFinanceira,
  GastoVarejo,
  InvestimentoInicialVarejo,
  MembroEquipeVarejo,
  MovimentoCaixaVarejo,
  VendaManualVarejo,
} from "@/lib/varejo/tipos";
import type { ItemRevisao, LinhaHistorico } from "./page";

type Props = {
  mesSelecionado: string;
  config: ConfigFinanceira | null;
  historico: LinhaHistorico[];
  resumo: LinhaHistorico | null;
  gastos: GastoVarejo[];
  equipe: MembroEquipeVarejo[];
  movimentosCaixa: MovimentoCaixaVarejo[];
  investimentoInicial: InvestimentoInicialVarejo[];
  vendasManuais: VendaManualVarejo[];
  diasComVendaNoPdv: string[];
  revisao: ItemRevisao[];
  metaPorDia: number | null;
};

type Aba = "resumo" | "lancamentos" | "historico" | "configuracao" | "revisar";

export function FinanceiroVarejoView(props: Props) {
  const [aba, setAba] = useState<Aba>("resumo");
  const router = useRouter();

  function mudarMes(mes: string) {
    router.push(`/varejo/financeiro?mes=${mes}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold">Controle Financeiro do Varejo</h1>
        <input
          type="month"
          value={props.mesSelecionado.slice(0, 7)}
          onChange={(e) => mudarMes(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-1 border-b border-line text-sm font-semibold">
        {(["resumo", "lancamentos", "historico", "revisar", "configuracao"] as Aba[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setAba(item)}
            className={`rounded-t-lg px-4 py-2 ${aba === item ? "border-b-2 border-rose-deep text-rose-deep" : "text-text-soft"}`}
          >
            {{ resumo: "Resumo", lancamentos: "Lançamentos", historico: "Histórico", revisar: "Revisar preços", configuracao: "Configuração" }[item]}
            {item === "revisar" && props.revisao.length > 0 && (
              <span className="ml-1.5 rounded-full bg-crit px-1.5 py-0.5 text-[0.65rem] text-white">{props.revisao.length}</span>
            )}
          </button>
        ))}
      </div>

      {aba === "resumo" && <AbaResumo {...props} />}
      {aba === "lancamentos" && <AbaLancamentos {...props} />}
      {aba === "historico" && <AbaHistorico historico={props.historico} />}
      {aba === "revisar" && <AbaRevisarPrecos revisao={props.revisao} />}
      {aba === "configuracao" && <AbaConfiguracao config={props.config} />}
    </div>
  );
}

// --- Revisar preços --------------------------------------------------------------------------------

function AbaRevisarPrecos({ revisao }: { revisao: ItemRevisao[] }) {
  if (revisao.length === 0) {
    return <Aviso texto="Nenhuma peça ativa está abaixo do preço mínimo ou no prejuízo agora — tudo certo." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-soft">
        Preço mínimo/piso calculados a partir do custo médio de entrada de cada peça. Nada aqui muda o preço gravado sozinho — ajuste manualmente quando fizer sentido.
      </p>
      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-text-soft">
              <th className="px-3 py-2">Peça</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Preço atual</th>
              <th className="px-3 py-2">Custo</th>
              <th className="px-3 py-2">Mínimo sugerido</th>
              <th className="px-3 py-2">Piso de prejuízo</th>
              <th className="px-3 py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {revisao.map((item) => (
              <tr key={item.variacao_id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">{item.produto_nome}</td>
                <td className="px-3 py-2 font-mono text-xs text-text-soft">#{item.sku}</td>
                <td className="px-3 py-2">{formatarMoeda(item.preco_venda)}</td>
                <td className="px-3 py-2">{formatarMoeda(item.custo)}</td>
                <td className="px-3 py-2">{item.precoMinimoComputado != null ? formatarMoeda(item.precoMinimoComputado) : "inviável"}</td>
                <td className="px-3 py-2">{Number.isFinite(item.pisoDePrejuizo) ? formatarMoeda(item.pisoDePrejuizo) : "inviável"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.status === "prejuizo" ? "bg-crit-bg text-crit" : "bg-warn-bg text-warn"}`}>
                    {item.status === "prejuizo" ? "Prejuízo" : "Abaixo do mínimo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Resumo ---------------------------------------------------------------------------------------

function AbaResumo({ config, resumo, metaPorDia }: Props) {
  if (!config || !resumo) {
    return (
      <Aviso texto="Nenhuma configuração cadastrada ainda. Vá em Configuração e lance a primeira vigência (gastos fixos, salário, fator de venda) pra começar a ver o resumo." />
    );
  }

  const pctEquilibrio = resumo.pontoDeEquilibrio > 0 && Number.isFinite(resumo.pontoDeEquilibrio) ? resumo.faturamento / resumo.pontoDeEquilibrio : 0;
  const corBarra = pctEquilibrio >= 1 ? "bg-ok" : pctEquilibrio >= 0.7 ? "bg-warn" : "bg-crit";

  let situacao = "Mês no lucro.";
  let tomSituacao: "ok" | "warn" | "crit" = "ok";
  if (resumo.resultado < 0) {
    situacao = `Abaixo do equilíbrio — faltam ${formatarMoeda(Math.max(0, resumo.pontoDeEquilibrio - resumo.faturamento))} pra fechar o mês no zero a zero.`;
    tomSituacao = "crit";
  } else if (pctEquilibrio < 1) {
    situacao = "Mês positivo, mas ainda não cobre o ponto de equilíbrio sozinho (compras/ajustes de caixa fizeram a diferença).";
    tomSituacao = "warn";
  }
  if (resumo.saldoCaixa < 0) {
    situacao = `Caixa negativo (${formatarMoeda(resumo.saldoCaixa)}).`;
    tomSituacao = "crit";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Faturamento × ponto de equilíbrio</span>
          <span className="text-text-soft">
            {formatarMoeda(resumo.faturamento)} / {Number.isFinite(resumo.pontoDeEquilibrio) ? formatarMoeda(resumo.pontoDeEquilibrio) : "—"}
          </span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-cream">
          <div className={`h-full ${corBarra}`} style={{ width: `${Math.min(100, pctEquilibrio * 100)}%` }} />
        </div>
        <p className={`mt-2 text-sm font-medium ${tomSituacao === "crit" ? "text-crit" : tomSituacao === "warn" ? "text-warn" : "text-ok"}`}>{situacao}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Vendas no mês" valor={String(resumo.numeroVendas)} nota="cupons concluídos" />
        <KpiCard label="Ticket médio" valor={resumo.ticketMedio != null ? formatarMoeda(resumo.ticketMedio) : "—"} nota="por venda" />
        {metaPorDia != null && (
          <KpiCard
            label="Meta por dia (resto do mês)"
            valor={metaPorDia > 0 ? formatarMoeda(metaPorDia) : "Batido"}
            nota={metaPorDia > 0 ? "pra fechar o ponto de equilíbrio" : "ponto de equilíbrio já coberto"}
            tom={metaPorDia > 0 ? "warn" : "ok"}
          />
        )}
        <KpiCard label="Margem de contribuição" valor={`${(resumo.margemContribuicaoPct * 100).toFixed(1)}%`} nota="após custo + despesas variáveis" />
        <KpiCard label="Devido ao Atacado" valor={formatarMoeda(resumo.devidoAoAtacado)} nota="custo das peças vendidas no mês" />
        <KpiCard label="Gastos + salários" valor={formatarMoeda(resumo.gastosMensais + resumo.salarios)} nota="fixo do mês" />
        <KpiCard
          label="Resultado do mês"
          valor={formatarMoeda(resumo.resultado)}
          nota={resumo.resultado >= 0 ? "lucro" : "prejuízo"}
          tom={resumo.resultado >= 0 ? "ok" : "crit"}
        />
        <KpiCard label="Compras de investimento" valor={formatarMoeda(resumo.compras)} nota="parcela do mês" />
        <KpiCard
          label="Saldo de caixa (fim do mês)"
          valor={formatarMoeda(resumo.saldoCaixa)}
          nota="acumulado desde a abertura"
          tom={resumo.saldoCaixa >= 0 ? "ok" : "crit"}
        />
        <KpiCard
          label="Investimento recuperado"
          valor={`${(resumo.recuperacaoPct * 100).toFixed(1)}%`}
          nota={resumo.recuperacaoPct >= 1 ? "totalmente recuperado" : "ainda recuperando"}
          tom={resumo.recuperacaoPct >= 1 ? "ok" : "rose"}
        />
      </div>
    </div>
  );
}

// --- Histórico -------------------------------------------------------------------------------------

function AbaHistorico({ historico }: { historico: LinhaHistorico[] }) {
  function exportarCsv() {
    const cabecalho = ["mes", "faturamento", "vendas", "custo_pecas", "despesas_variaveis", "gastos", "salarios", "resultado", "compras", "movimentos", "saldo_caixa", "pct_equilibrio", "pct_recuperado"];
    const linhas = historico.map((h) =>
      [
        h.mes.slice(0, 7),
        h.faturamento.toFixed(2),
        h.numeroVendas,
        h.custoDasPecas.toFixed(2),
        h.despesasVariaveis.toFixed(2),
        h.gastosMensais.toFixed(2),
        h.salarios.toFixed(2),
        h.resultado.toFixed(2),
        h.compras.toFixed(2),
        h.movimentos.toFixed(2),
        h.saldoCaixa.toFixed(2),
        Number.isFinite(h.pontoDeEquilibrio) && h.pontoDeEquilibrio > 0 ? ((h.faturamento / h.pontoDeEquilibrio) * 100).toFixed(1) : "",
        (h.recuperacaoPct * 100).toFixed(1),
      ].join(","),
    );
    baixarTexto([cabecalho.join(","), ...linhas].join("\n"), "controle-financeiro-varejo.csv");
  }

  if (historico.length === 0) return <Aviso texto="Sem histórico ainda — cadastre a configuração inicial na aba Configuração." />;

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={exportarCsv} className="self-start text-xs font-semibold text-rose-deep underline decoration-dotted">
        Exportar CSV
      </button>
      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-text-soft">
              <th className="px-3 py-2">Mês</th>
              <th className="px-3 py-2">Faturamento</th>
              <th className="px-3 py-2">Vendas</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Saldo de caixa</th>
              <th className="px-3 py-2">% equilíbrio</th>
              <th className="px-3 py-2">% recuperado</th>
            </tr>
          </thead>
          <tbody>
            {historico.map((h) => {
              const pct = Number.isFinite(h.pontoDeEquilibrio) && h.pontoDeEquilibrio > 0 ? h.faturamento / h.pontoDeEquilibrio : 0;
              return (
                <tr key={h.mes} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium">{h.mes.slice(0, 7)}</td>
                  <td className="px-3 py-2">{formatarMoeda(h.faturamento)}</td>
                  <td className="px-3 py-2">{h.numeroVendas}</td>
                  <td className={`px-3 py-2 font-medium ${h.resultado >= 0 ? "text-ok" : "text-crit"}`}>{formatarMoeda(h.resultado)}</td>
                  <td className={`px-3 py-2 ${h.saldoCaixa >= 0 ? "" : "text-crit"}`}>{formatarMoeda(h.saldoCaixa)}</td>
                  <td className="px-3 py-2">{(pct * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">{(h.recuperacaoPct * 100).toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Configuração ------------------------------------------------------------------------------

function AbaConfiguracao({ config }: { config: ConfigFinanceira | null }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const resultado = await criarVigenciaConfig({
        vigenteDesde: String(formData.get("vigente_desde")),
        fatorVendaPadrao: Number(formData.get("fator_venda_padrao")),
        fatorVendaMin: Number(formData.get("fator_venda_min")),
        fatorVendaMax: Number(formData.get("fator_venda_max")),
        despesasVariaveisPct: Number(formData.get("despesas_variaveis_pct")),
        lucroDesejadoPct: Number(formData.get("lucro_desejado_pct")),
        diasAbertosMes: Number(formData.get("dias_abertos_mes")),
        encargosCltPct: Number(formData.get("encargos_clt_pct")),
        caixaInicialTexto: String(formData.get("caixa_inicial")),
        mesAbertura: String(formData.get("mes_abertura")),
        precoPisoEntradaTexto: String(formData.get("preco_piso_entrada")),
        arredondar90: formData.get("arredondar_90") === "on",
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
    });
  }

  const markup = config ? (config.fator_venda_padrao / 2.8).toFixed(3) : null;

  return (
    <div className="flex flex-col gap-4">
      {config && (
        <div className="rounded-[14px] border border-line bg-surface p-4 text-sm shadow-sm">
          <p className="font-semibold">Vigente desde {config.vigente_desde.slice(0, 7)}</p>
          <p className="mt-1 text-text-soft">
            Fator de venda {config.fator_venda_padrao} (faixa {config.fator_venda_min}–{config.fator_venda_max}) · markup ≈ {markup}× sobre o custo ·
            despesas variáveis {(config.despesas_variaveis_pct * 100).toFixed(1)}% · {config.dias_abertos_mes} dias abertos/mês · encargos{" "}
            {(config.encargos_clt_pct * 100).toFixed(1)}%
          </p>
        </div>
      )}

      <form action={salvar} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm font-semibold">Nova vigência</p>
        <p className="text-xs text-text-soft">Alterar aqui recalcula sugestões e metas — nunca muda o preço já gravado em nenhuma peça.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormField label="Vigente desde" name="vigente_desde" type="month" defaultValue={config?.vigente_desde.slice(0, 7)} required />
          <FormField label="Mês de abertura" name="mes_abertura" type="month" defaultValue={config?.mes_abertura.slice(0, 7)} required />
          <FormField label="Dias abertos/mês" name="dias_abertos_mes" type="number" min={1} max={31} defaultValue={config?.dias_abertos_mes ?? 26} required />
          <FormField label="Fator de venda padrão" name="fator_venda_padrao" type="number" step="0.0001" min={0} defaultValue={config?.fator_venda_padrao ?? 10.1} required />
          <FormField label="Fator de venda mínimo" name="fator_venda_min" type="number" step="0.0001" min={0} defaultValue={config?.fator_venda_min ?? 9.0} required />
          <FormField label="Fator de venda máximo" name="fator_venda_max" type="number" step="0.0001" min={0} defaultValue={config?.fator_venda_max ?? 11.2} required />
          <FormField label="Despesas variáveis (%)" name="despesas_variaveis_pct" type="number" step="0.01" min={0} max={100} defaultValue={config ? config.despesas_variaveis_pct * 100 : 10} required />
          <FormField label="Lucro desejado (%)" name="lucro_desejado_pct" type="number" step="0.01" min={0} max={100} defaultValue={config ? config.lucro_desejado_pct * 100 : 15} required />
          <FormField label="Encargos CLT (%)" name="encargos_clt_pct" type="number" step="0.01" min={0} defaultValue={config ? config.encargos_clt_pct * 100 : 34} required />
          <FormField label="Caixa inicial (R$)" name="caixa_inicial" defaultValue={config?.caixa_inicial ?? 0} />
          <FormField label="Piso de entrada (R$)" name="preco_piso_entrada" defaultValue={config?.preco_piso_entrada ?? 19.9} required />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="arredondar_90" defaultChecked={config?.arredondar_90 ?? true} className="h-4 w-4 accent-rose" />
          Arredondar preço sugerido pra terminar em ,90
        </label>
        {erro && <p className="text-sm text-crit">{erro}</p>}
        <button type="submit" disabled={pendente} className="self-start rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2 text-sm font-semibold text-gold-ink disabled:opacity-60">
          {pendente ? "Salvando…" : "Salvar nova vigência"}
        </button>
      </form>

      <ImportarControleAntigo />
    </div>
  );
}

function ImportarControleAntigo() {
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<{ erro?: string; resumo?: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  function importar() {
    setResultado(null);
    iniciar(async () => {
      setResultado(await importarControleAntigo(texto));
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-dashed border-line bg-surface p-4 text-sm">
      <p className="font-semibold">Importar controle antigo (uma vez só)</p>
      <p className="text-xs text-text-soft">Cole o JSON exportado da planilha/página antiga. Vendas são seguras de reimportar; gastos/equipe/movimentos não — rode só uma vez.</p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={4}
        className="rounded-lg border border-line bg-cream px-3 py-2 font-mono text-xs"
        placeholder='{"config": {...}, "gastos": [...], ...}'
      />
      {resultado?.erro && <p className="text-crit">{resultado.erro}</p>}
      {resultado?.resumo && <p className="text-ok">{resultado.resumo}</p>}
      <button type="button" onClick={importar} disabled={pendente || !texto.trim()} className="self-start rounded-full border border-rose px-4 py-1.5 font-semibold text-rose-deep disabled:opacity-50">
        {pendente ? "Importando…" : "Importar"}
      </button>
    </div>
  );
}

// --- Lançamentos -----------------------------------------------------------------------------------

function AbaLancamentos(props: Props) {
  return (
    <div className="flex flex-col gap-5">
      <SecaoGastos gastos={props.gastos} />
      <SecaoEquipe equipe={props.equipe} />
      <SecaoMovimentosCaixa movimentos={props.movimentosCaixa} />
      <SecaoInvestimentoInicial investimentos={props.investimentoInicial} />
      <SecaoVendasManuais vendas={props.vendasManuais} diasComVendaNoPdv={props.diasComVendaNoPdv} />
    </div>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </div>
  );
}

function BotaoApagar({ aoConfirmar }: { aoConfirmar: () => Promise<{ erro?: string }> }) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const resultado = await aoConfirmar();
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setConfirmando(false);
    });
  }

  if (confirmando) {
    return (
      <span className="text-xs">
        {erro ? <span className="font-medium text-crit">{erro} </span> : "Apagar mesmo? "}
        <button type="button" disabled={pendente} onClick={confirmar} className="font-semibold text-crit underline disabled:opacity-60">
          Sim
        </button>{" "}
        <button type="button" onClick={() => { setConfirmando(false); setErro(null); }} className="text-text-soft underline">
          Não
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setConfirmando(true)} className="text-xs font-semibold text-crit underline decoration-dotted">
      Apagar
    </button>
  );
}

/**
 * Seção genérica de lançamento (lista + modal de criar/editar + apagar) — as 5 seções da aba
 * Lançamentos têm a mesma mecânica (abrir/fechar modal, criar vs editar, erro/pendente, tabela com
 * Editar/Apagar); só o conjunto de campos e as 3 server actions mudam de uma pra outra.
 */
function SecaoCrud<T extends { id: string }, D>({
  titulo,
  itens,
  colunas,
  tituloNovo,
  tituloEditar,
  extrairDados,
  criar,
  editar,
  apagar,
  renderForm,
}: {
  titulo: string;
  itens: T[];
  colunas: { cabecalho: string; render: (item: T) => React.ReactNode }[];
  tituloNovo: string;
  tituloEditar: string;
  extrairDados: (formData: FormData) => D;
  criar: (dados: D) => Promise<{ erro?: string }>;
  editar: (id: string, dados: D) => Promise<{ erro?: string }>;
  apagar: (id: string) => Promise<{ erro?: string }>;
  renderForm: (editando: T | null) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function fechar() {
    setAberto(false);
    setEditando(null);
    setErro(null);
  }

  function salvar(formData: FormData) {
    setErro(null);
    const dados = extrairDados(formData);
    iniciar(async () => {
      const resultado = editando ? await editar(editando.id, dados) : await criar(dados);
      if (resultado.erro) return setErro(resultado.erro);
      fechar();
    });
  }

  return (
    <Secao
      titulo={titulo}
      acao={
        <button type="button" onClick={() => { setEditando(null); setAberto(true); }} className="text-xs font-semibold text-rose-deep underline decoration-dotted">
          + Novo
        </button>
      }
    >
      <TabelaSimples
        colunas={[...colunas.map((c) => c.cabecalho), ""]}
        linhas={itens.map((item) => [
          ...colunas.map((c) => c.render(item)),
          <span key="acoes" className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditando(item); setAberto(true); }} className="text-xs font-semibold text-rose-deep underline decoration-dotted">
              Editar
            </button>
            <BotaoApagar aoConfirmar={() => apagar(item.id)} />
          </span>,
        ])}
      />
      <Modal aberto={aberto} onFechar={fechar} titulo={editando ? tituloEditar : tituloNovo}>
        <form key={editando?.id ?? "novo"} action={salvar} className="flex flex-col gap-3">
          {renderForm(editando)}
          {erro && <p className="text-sm text-crit">{erro}</p>}
          <button type="submit" disabled={pendente} className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60">
            {pendente ? "Salvando…" : "Salvar"}
          </button>
        </form>
      </Modal>
    </Secao>
  );
}

function SecaoGastos({ gastos }: { gastos: GastoVarejo[] }) {
  return (
    <SecaoCrud<GastoVarejo, DadosGasto>
      titulo="Gastos fixos e compras"
      itens={gastos}
      tituloNovo="Novo gasto"
      tituloEditar="Editar gasto"
      criar={criarGasto}
      editar={editarGasto}
      apagar={apagarGasto}
      colunas={[
        { cabecalho: "Descrição", render: (g) => g.descricao },
        { cabecalho: "Tipo", render: (g) => (g.tipo === "mensal" ? "Mensal" : "Compra") },
        { cabecalho: "Valor", render: (g) => formatarMoeda(g.valor) },
        { cabecalho: "Início", render: (g) => g.mes_inicio.slice(0, 7) },
        { cabecalho: "Fim/Parcelas", render: (g) => (g.tipo === "mensal" ? (g.mes_fim ? g.mes_fim.slice(0, 7) : "contínuo") : `${g.parcelas}x`) },
      ]}
      extrairDados={(formData) => {
        const tipo = String(formData.get("tipo")) as DadosGasto["tipo"];
        return {
          descricao: String(formData.get("descricao") ?? ""),
          tipo,
          valorTexto: String(formData.get("valor") ?? ""),
          mesInicio: `${formData.get("mes_inicio")}`,
          mesFim: tipo === "mensal" ? String(formData.get("mes_fim") || "") || null : null,
          parcelas: tipo === "compra" ? Number(formData.get("parcelas")) : null,
        };
      }}
      renderForm={(editando) => (
        <>
          <FormField label="Descrição" name="descricao" defaultValue={editando?.descricao} required />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Tipo</span>
            <select name="tipo" defaultValue={editando?.tipo ?? "mensal"} className="rounded-lg border border-line bg-cream px-3 py-2">
              <option value="mensal">Mensal (recorrente)</option>
              <option value="compra">Compra parcelada (investimento)</option>
            </select>
          </label>
          <FormField label="Valor (R$)" name="valor" defaultValue={editando?.valor} required />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Início" name="mes_inicio" type="month" defaultValue={editando?.mes_inicio.slice(0, 7)} required />
            <FormField label="Fim (mensal, opcional) / Parcelas (compra)" name="mes_fim" type="month" defaultValue={editando?.mes_fim?.slice(0, 7)} />
          </div>
          <FormField label="Parcelas (só compra)" name="parcelas" type="number" min={1} defaultValue={editando?.parcelas ?? undefined} />
        </>
      )}
    />
  );
}

function SecaoEquipe({ equipe }: { equipe: MembroEquipeVarejo[] }) {
  return (
    <SecaoCrud<MembroEquipeVarejo, DadosMembroEquipe>
      titulo="Equipe e pró-labore"
      itens={equipe}
      tituloNovo="Novo membro"
      tituloEditar="Editar membro"
      criar={criarMembroEquipe}
      editar={editarMembroEquipe}
      apagar={apagarMembroEquipe}
      colunas={[
        { cabecalho: "Nome", render: (m) => m.nome },
        { cabecalho: "Custo mensal", render: (m) => formatarMoeda(m.salario) },
        { cabecalho: "Encargos", render: (m) => (m.somar_encargos ? "Soma" : "Já incluso") },
        { cabecalho: "Início", render: (m) => m.mes_inicio.slice(0, 7) },
        { cabecalho: "Fim", render: (m) => (m.mes_fim ? m.mes_fim.slice(0, 7) : "contínuo") },
      ]}
      extrairDados={(formData) => ({
        nome: String(formData.get("nome") ?? ""),
        salarioTexto: String(formData.get("salario") ?? ""),
        somarEncargos: formData.get("somar_encargos") === "on",
        mesInicio: `${formData.get("mes_inicio")}`,
        mesFim: String(formData.get("mes_fim") || "") || null,
      })}
      renderForm={(editando) => (
        <>
          <FormField label="Nome" name="nome" defaultValue={editando?.nome} required />
          <FormField label="Custo mensal total (R$)" name="salario" defaultValue={editando?.salario} required />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="somar_encargos" defaultChecked={editando?.somar_encargos ?? false} className="h-4 w-4 accent-rose" />
            Somar encargos CLT por cima (desmarcado = valor já é o custo total)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Início" name="mes_inicio" type="month" defaultValue={editando?.mes_inicio.slice(0, 7)} required />
            <FormField label="Fim (opcional)" name="mes_fim" type="month" defaultValue={editando?.mes_fim?.slice(0, 7)} />
          </div>
        </>
      )}
    />
  );
}

function SecaoMovimentosCaixa({ movimentos }: { movimentos: MovimentoCaixaVarejo[] }) {
  return (
    <SecaoCrud<MovimentoCaixaVarejo, DadosMovimentoCaixa>
      titulo="Movimentos de caixa (fora de venda)"
      itens={movimentos}
      tituloNovo="Novo movimento"
      tituloEditar="Editar movimento"
      criar={criarMovimentoCaixa}
      editar={editarMovimentoCaixa}
      apagar={apagarMovimentoCaixa}
      colunas={[
        { cabecalho: "Data", render: (m) => m.data },
        { cabecalho: "Tipo", render: (m) => (m.tipo === "entrada" ? "Entrada" : "Saída") },
        { cabecalho: "Descrição", render: (m) => m.descricao },
        { cabecalho: "Valor", render: (m) => formatarMoeda(m.valor) },
      ]}
      extrairDados={(formData) => ({
        data: String(formData.get("data") ?? ""),
        tipo: String(formData.get("tipo")) as DadosMovimentoCaixa["tipo"],
        descricao: String(formData.get("descricao") ?? ""),
        valorTexto: String(formData.get("valor") ?? ""),
      })}
      renderForm={(editando) => (
        <>
          <FormField label="Data" name="data" type="date" defaultValue={editando?.data} required />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Tipo</span>
            <select name="tipo" defaultValue={editando?.tipo ?? "entrada"} className="rounded-lg border border-line bg-cream px-3 py-2">
              <option value="entrada">Entrada (aporte, empréstimo)</option>
              <option value="saida">Saída (retirada de lucro)</option>
            </select>
          </label>
          <FormField label="Descrição" name="descricao" defaultValue={editando?.descricao} required />
          <FormField label="Valor (R$)" name="valor" defaultValue={editando?.valor} required />
        </>
      )}
    />
  );
}

function SecaoInvestimentoInicial({ investimentos }: { investimentos: InvestimentoInicialVarejo[] }) {
  const total = investimentos.reduce((s, i) => s + i.valor, 0);
  return (
    <SecaoCrud<InvestimentoInicialVarejo, DadosInvestimentoInicial>
      titulo={`Investimento inicial (total: ${formatarMoeda(total)})`}
      itens={investimentos}
      tituloNovo="Novo investimento"
      tituloEditar="Editar investimento"
      criar={criarInvestimentoInicial}
      editar={editarInvestimentoInicial}
      apagar={apagarInvestimentoInicial}
      colunas={[
        { cabecalho: "Data", render: (i) => i.data },
        { cabecalho: "Descrição", render: (i) => i.descricao },
        { cabecalho: "Valor", render: (i) => formatarMoeda(i.valor) },
      ]}
      extrairDados={(formData) => ({
        data: String(formData.get("data") ?? ""),
        descricao: String(formData.get("descricao") ?? ""),
        valorTexto: String(formData.get("valor") ?? ""),
      })}
      renderForm={(editando) => (
        <>
          <FormField label="Data" name="data" type="date" defaultValue={editando?.data} required />
          <FormField label="Descrição" name="descricao" defaultValue={editando?.descricao} required />
          <FormField label="Valor (R$)" name="valor" defaultValue={editando?.valor} required />
        </>
      )}
    />
  );
}

function SecaoVendasManuais({ vendas, diasComVendaNoPdv }: { vendas: VendaManualVarejo[]; diasComVendaNoPdv: string[] }) {
  const diasPdv = new Set(diasComVendaNoPdv);
  return (
    <div className="flex flex-col gap-2">
      <SecaoCrud<VendaManualVarejo, DadosVendaManual>
        titulo="Vendas manuais (dia sem PDV ou importação)"
        itens={vendas}
        tituloNovo="Nova venda manual"
        tituloEditar="Editar venda manual"
        criar={criarVendaManual}
        editar={editarVendaManual}
        apagar={apagarVendaManual}
        colunas={[
          { cabecalho: "Data", render: (v) => v.data },
          {
            cabecalho: "Faturamento",
            render: (v) => <span className={diasPdv.has(v.data) ? "text-text-soft line-through" : ""}>{formatarMoeda(v.faturamento)}</span>,
          },
          { cabecalho: "Vendas", render: (v) => v.numero_vendas },
          { cabecalho: "Origem", render: (v) => (v.origem === "manual" ? "Manual" : "Importação") },
        ]}
        extrairDados={(formData) => ({
          data: String(formData.get("data") ?? ""),
          faturamentoTexto: String(formData.get("faturamento") ?? ""),
          numeroVendas: Number(formData.get("numero_vendas")),
        })}
        renderForm={(editando) => (
          <>
            <FormField label="Data" name="data" type="date" defaultValue={editando?.data} required />
            {editando && diasPdv.has(editando.data) && (
              <p className="text-xs text-warn">Esse dia já tem venda no PDV — essa linha manual será ignorada no cálculo.</p>
            )}
            <FormField label="Faturamento do dia (R$)" name="faturamento" defaultValue={editando?.faturamento} required />
            <FormField label="Número de vendas" name="numero_vendas" type="number" min={0} defaultValue={editando?.numero_vendas} required />
          </>
        )}
      />
      {diasComVendaNoPdv.length > 0 && (
        <p className="text-xs text-text-soft">Dias riscados já têm venda real no PDV este mês — o PDV prevalece no cálculo, a venda manual é ignorada.</p>
      )}
    </div>
  );
}

function TabelaSimples({ colunas, linhas }: { colunas: string[]; linhas: React.ReactNode[][] }) {
  if (linhas.length === 0) {
    return <p className="rounded-[14px] border border-dashed border-line bg-surface p-4 text-center text-xs text-text-soft">Nada cadastrado ainda.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-text-soft">
            {colunas.map((c, i) => (
              <th key={i} className="px-3 py-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {linha.map((celula, j) => (
                <td key={j} className="px-3 py-2">
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">{texto}</div>;
}
