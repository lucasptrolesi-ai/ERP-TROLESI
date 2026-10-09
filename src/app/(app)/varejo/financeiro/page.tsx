import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import {
  calcularMes,
  calcularPisoDePrejuizo,
  calcularPrecoMinimo,
  custoEquipeNoMes,
  margemContribuicaoTeorica,
  mesSeguinte,
  mesclarFaturamentoDiario,
  metaPorDiaRestante,
  recuperacaoDoInvestimento,
  saldoDeCaixa,
  statusDoPreco,
  valorNoMes,
  vigenteNoMes,
  type EntradaMes,
  type Mes,
  type ResultadoMes,
  type StatusPreco,
  type VendaDoDia,
} from "@/lib/varejo/financeiro";
import { buscarCalculadoraPreco } from "@/lib/varejo/financeiro-dados";
import { FinanceiroVarejoView } from "./financeiro-varejo-view";
import type {
  ConfigFinanceira,
  DividaAtacadoVarejo,
  GastoVarejo,
  InvestimentoInicialVarejo,
  MembroEquipeVarejo,
  MovimentoCaixaVarejo,
  VendaManualVarejo,
} from "@/lib/varejo/tipos";

export type LinhaHistorico = ResultadoMes & { mes: Mes; compras: number; movimentos: number; saldoCaixa: number; recuperacaoPct: number };

export type ItemRevisao = {
  variacao_id: string;
  produto_nome: string;
  sku: string;
  preco_venda: number;
  custo: number;
  pisoDePrejuizo: number;
  precoMinimoComputado: number | null;
  status: StatusPreco;
};

function mesAtual(): Mes {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function FinanceiroVarejoPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();
  const { mes: mesParam } = await searchParams;

  if (perfil.papel !== "admin") {
    return <Aviso texto="O Controle Financeiro é restrito a administradores." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para acessar o Controle Financeiro." />;
  }

  const supabase = await createClient();
  const [
    { data: configs },
    { data: gastos },
    { data: equipe },
    { data: movimentosCaixa },
    { data: investimentoInicial },
    { data: vendasManuais },
    { data: vendas },
    { data: multiplicadores },
    { data: dividasBrutas },
  ] = await Promise.all([
    supabase.from("varejo_config").select("*").order("vigente_desde"),
    supabase.from("varejo_gastos").select("*").order("mes_inicio"),
    supabase.from("varejo_equipe").select("*").order("mes_inicio"),
    supabase.from("varejo_movimentos_caixa").select("*").order("data"),
    supabase.from("varejo_investimento_inicial").select("*").order("data"),
    supabase.from("varejo_vendas_manuais").select("*").order("data"),
    supabase.from("vendas").select("id, criada_em, total").eq("status", "concluida"),
    supabase.from("parametros_multiplicador").select("valor, vigente_de, vigente_ate").eq("chave", "TRANSFERENCIA_ATACADO_VAREJO"),
    supabase
      .from("varejo_dividas_atacado")
      .select("id, variacao_id, codigo_atacado, quantidade, custo_unitario, custo_total, status, pago_em, criado_em, catalogo_variacoes(sku, catalogo_produtos(nome))")
      .order("criado_em", { ascending: false }),
  ]);

  const dividasAtacado: DividaAtacadoVarejo[] = (dividasBrutas ?? []).map((d) => {
    const variacao = Array.isArray(d.catalogo_variacoes) ? d.catalogo_variacoes[0] : d.catalogo_variacoes;
    const produto = variacao ? (Array.isArray(variacao.catalogo_produtos) ? variacao.catalogo_produtos[0] : variacao.catalogo_produtos) : null;
    return {
      id: d.id,
      variacao_id: d.variacao_id,
      produto_nome: produto?.nome ?? "",
      sku: variacao?.sku ?? "",
      codigo_atacado: d.codigo_atacado,
      quantidade: d.quantidade,
      custo_unitario: d.custo_unitario,
      custo_total: d.custo_total,
      status: d.status,
      pago_em: d.pago_em,
      criado_em: d.criado_em,
    };
  });

  const vendaIds = (vendas ?? []).map((v) => v.id as string);
  const [{ data: itensVendidos }, calculadora] = await Promise.all([
    vendaIds.length
      ? supabase.from("venda_itens").select("venda_id, quantidade, custo_unitario").in("venda_id", vendaIds)
      : Promise.resolve({ data: [] as { venda_id: string; quantidade: number; custo_unitario: number }[] }),
    buscarCalculadoraPreco(supabase, {
      configs: configs as ConfigFinanceira[] | null,
      gastos: gastos as GastoVarejo[] | null,
      equipe: equipe as MembroEquipeVarejo[] | null,
      multiplicadores,
    }),
  ]);

  const mesSelecionado: Mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? `${mesParam}-01` : mesAtual();
  const hojeEMesAtual = mesSelecionado === mesAtual();

  if (!configs || configs.length === 0) {
    return (
      <FinanceiroVarejoView
        mesSelecionado={mesSelecionado}
        config={null}
        historico={[]}
        resumo={null}
        gastos={gastos ?? []}
        equipe={equipe ?? []}
        movimentosCaixa={movimentosCaixa ?? []}
        investimentoInicial={investimentoInicial ?? []}
        vendasManuais={vendasManuais ?? []}
        diasComVendaNoPdv={[]}
        revisao={[]}
        metaPorDia={null}
        dividasAtacado={dividasAtacado}
      />
    );
  }

  // Custo por venda (soma dos itens) e depois por dia -------------------------------------------
  const custoPorVenda = new Map<string, number>();
  for (const item of itensVendidos ?? []) {
    custoPorVenda.set(item.venda_id, (custoPorVenda.get(item.venda_id) ?? 0) + item.quantidade * item.custo_unitario);
  }
  const porDiaPdv = new Map<string, { faturamento: number; custo: number; numeroVendas: number }>();
  for (const v of vendas ?? []) {
    const dia = (v.criada_em as string).slice(0, 10);
    const atual = porDiaPdv.get(dia) ?? { faturamento: 0, custo: 0, numeroVendas: 0 };
    atual.faturamento += v.total as number;
    atual.custo += custoPorVenda.get(v.id as string) ?? 0;
    atual.numeroVendas += 1;
    porDiaPdv.set(dia, atual);
  }
  const vendasPdvPorDia: VendaDoDia[] = [...porDiaPdv.entries()].map(([data, v]) => ({ data, faturamento: v.faturamento, numeroVendas: v.numeroVendas }));
  const custoPdvPorDia = new Map([...porDiaPdv.entries()].map(([dia, v]) => [dia, v.custo]));
  const vendasManuaisPorDia: VendaDoDia[] = (vendasManuais ?? []).map((v) => ({ data: v.data, faturamento: v.faturamento, numeroVendas: v.numero_vendas }));
  const diasComPdv = new Set(vendasPdvPorDia.map((v) => v.data));

  function fatorCustoNoMes(mes: Mes): number {
    const linha = (multiplicadores ?? []).find((m) => m.vigente_de <= mes && (!m.vigente_ate || m.vigente_ate >= mes));
    return linha?.valor ?? 2.8;
  }

  // Apuração mês a mês, da abertura até o mês selecionado (acumula caixa e investimento) ----------
  const mesAbertura = (configs as ConfigFinanceira[])[0].mes_abertura.slice(0, 7) + "-01";
  const caixaInicial = (configs as ConfigFinanceira[])[0].caixa_inicial;
  const investimentoInicialTotal = (investimentoInicial ?? []).reduce((s, i) => s + i.valor, 0);

  const historico: LinhaHistorico[] = [];
  let somaResultados = 0;
  let somaComprasAcumuladas = 0;
  let somaMovimentosAcumulados = 0;
  let investimentoTotalAcumulado = investimentoInicialTotal;

  for (let mes = mesAbertura; mes <= mesSelecionado; mes = mesSeguinte(mes, 1)) {
    const config = vigenteNoMes(configs as ConfigFinanceira[], mes);
    if (!config) continue;

    const diaDoMes = (d: string) => d.slice(0, 7) === mes.slice(0, 7);
    const pdvDoMes = vendasPdvPorDia.filter((v) => diaDoMes(v.data));
    const manuaisDoMes = vendasManuaisPorDia.filter((v) => diaDoMes(v.data));
    const diasMesclados = mesclarFaturamentoDiario(pdvDoMes, manuaisDoMes);
    const faturamento = diasMesclados.reduce((s, d) => s + d.faturamento, 0);
    const numeroVendas = diasMesclados.reduce((s, d) => s + d.numeroVendas, 0);

    const fatorCusto = fatorCustoNoMes(mes);
    const markup = config.fator_venda_padrao / fatorCusto;
    const custoDasPecas = diasMesclados.reduce((s, d) => {
      if (diasComPdv.has(d.data)) return s + (custoPdvPorDia.get(d.data) ?? 0);
      return s + (markup > 0 ? d.faturamento / markup : 0);
    }, 0);

    const gastosLista = (gastos ?? []) as GastoVarejo[];
    const gastosMensais = gastosLista
      .filter((g) => g.tipo === "mensal")
      .reduce((s, g) => s + valorNoMes({ tipo: "mensal", valor: g.valor, mesInicio: g.mes_inicio, mesFim: g.mes_fim }, mes), 0);
    const compras = gastosLista
      .filter((g) => g.tipo === "compra")
      .reduce((s, g) => s + valorNoMes({ tipo: "compra", valor: g.valor, mesInicio: g.mes_inicio, parcelas: g.parcelas ?? 1 }, mes), 0);

    const salarios = custoEquipeNoMes(
      (equipe as MembroEquipeVarejo[] ?? []).map((m) => ({ salario: m.salario, somarEncargos: m.somar_encargos, mesInicio: m.mes_inicio, mesFim: m.mes_fim })),
      mes,
      config.encargos_clt_pct,
    );

    const movimentosDoMes = (movimentosCaixa ?? [])
      .filter((m) => diaDoMes(m.data))
      .reduce((s, m) => s + (m.tipo === "entrada" ? m.valor : -m.valor), 0);

    const entrada: EntradaMes = {
      faturamento,
      numeroVendas,
      custoDasPecas,
      despesasVariaveisPct: config.despesas_variaveis_pct,
      margemTeoricaFallback: margemContribuicaoTeorica(markup, config.despesas_variaveis_pct),
      gastosMensais,
      salarios,
      movimentosCaixa: movimentosDoMes,
      compras,
    };
    const resultadoMes = calcularMes(entrada, config.dias_abertos_mes);

    // Investimento total até M: inicial + valor CHEIO de cada compra cujo mes_inicio <= M (regra 4).
    for (const g of gastosLista.filter((x) => x.tipo === "compra" && x.mes_inicio.slice(0, 7) === mes.slice(0, 7))) {
      investimentoTotalAcumulado += g.valor;
    }

    somaResultados += resultadoMes.resultado;
    somaComprasAcumuladas += compras;
    somaMovimentosAcumulados += movimentosDoMes;

    const saldoCaixa = saldoDeCaixa(caixaInicial, somaResultados, somaComprasAcumuladas, somaMovimentosAcumulados);
    const recuperacao = recuperacaoDoInvestimento(investimentoTotalAcumulado, somaResultados);

    historico.push({ ...resultadoMes, mes, compras, movimentos: movimentosDoMes, saldoCaixa, recuperacaoPct: recuperacao.percentual });
  }

  const resumo = historico.length ? historico[historico.length - 1] : null;
  // Todos os dias com venda no PDV (não só do mês selecionado): a aba Lançamentos lista vendas
  // manuais de qualquer mês, e o aviso "esse dia já tem venda no PDV" precisa valer pra qualquer uma.
  const dias = new Set((vendas ?? []).map((v) => (v.criada_em as string).slice(0, 10)));

  // Meta de faturamento por dia restante -- só faz sentido olhando o mês corrente, em andamento.
  let metaPorDia: number | null = null;
  if (hojeEMesAtual && resumo && Number.isFinite(resumo.pontoDeEquilibrio)) {
    const hoje = new Date();
    const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const diasCorridosRestantes = diasNoMes - hoje.getDate() + 1;
    const configAtual = vigenteNoMes(configs as ConfigFinanceira[], mesSelecionado);
    if (configAtual) {
      metaPorDia = metaPorDiaRestante(resumo.pontoDeEquilibrio, resumo.faturamento, diasCorridosRestantes, configAtual.dias_abertos_mes, diasNoMes);
    }
  }

  // Revisar preços: produtos ativos com custo conhecido, abaixo do mínimo ou vendendo no prejuízo.
  const revisao: ItemRevisao[] = [];
  if (calculadora) {
    const [{ data: variacoesAtivas }, { data: entradasEstoque }] = await Promise.all([
      supabase
        .from("catalogo_variacoes")
        .select("id, sku, preco_venda, catalogo_produtos(nome)")
        .eq("ativo", true),
      supabase.from("estoque_movimentos").select("variacao_id, quantidade, custo_unitario").gt("quantidade", 0),
    ]);
    const custoPorVariacao = new Map<string, { soma: number; qtd: number }>();
    for (const m of entradasEstoque ?? []) {
      const atual = custoPorVariacao.get(m.variacao_id) ?? { soma: 0, qtd: 0 };
      atual.soma += m.quantidade * m.custo_unitario;
      atual.qtd += m.quantidade;
      custoPorVariacao.set(m.variacao_id, atual);
    }
    for (const v of variacoesAtivas ?? []) {
      const acumulado = custoPorVariacao.get(v.id);
      if (!acumulado || acumulado.qtd === 0) continue;
      const custo = acumulado.soma / acumulado.qtd;
      const pisoDePrejuizo = calcularPisoDePrejuizo(custo, calculadora.config.despesas_variaveis_pct);
      const precoMinimoComputado = calculadora.markupMinimo.viavel ? calcularPrecoMinimo(custo, calculadora.markupMinimo.markup) : null;
      const status = statusDoPreco(v.preco_venda, precoMinimoComputado ?? pisoDePrejuizo, pisoDePrejuizo);
      if (status === "ok") continue;
      const produto = Array.isArray(v.catalogo_produtos) ? v.catalogo_produtos[0] : v.catalogo_produtos;
      revisao.push({ variacao_id: v.id, produto_nome: produto?.nome ?? "", sku: v.sku, preco_venda: v.preco_venda, custo, pisoDePrejuizo, precoMinimoComputado, status });
    }
  }

  return (
    <FinanceiroVarejoView
      mesSelecionado={mesSelecionado}
      config={vigenteNoMes(configs as ConfigFinanceira[], mesSelecionado)}
      historico={historico}
      resumo={resumo}
      gastos={(gastos ?? []) as GastoVarejo[]}
      equipe={(equipe ?? []) as MembroEquipeVarejo[]}
      movimentosCaixa={(movimentosCaixa ?? []) as MovimentoCaixaVarejo[]}
      investimentoInicial={(investimentoInicial ?? []) as InvestimentoInicialVarejo[]}
      vendasManuais={(vendasManuais ?? []) as VendaManualVarejo[]}
      diasComVendaNoPdv={[...dias]}
      revisao={revisao}
      metaPorDia={metaPorDia}
      dividasAtacado={dividasAtacado}
    />
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
