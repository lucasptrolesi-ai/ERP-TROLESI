import { arredondarMoeda } from "@/lib/dinheiro";

/**
 * Motor de cálculo do Controle Financeiro do Varejo — funções puras, sem acesso a banco (a leitura
 * de dados fica nos Server Actions/RPCs que alimentam estas funções). Único lugar do app que sabe
 * fórmula de markup/margem/ponto de equilíbrio/precificação — telas, PDV e relatórios só consultam
 * isto, nunca recalculam por conta própria (regra 4 do documento do módulo).
 *
 * O preço de venda GRAVADO no produto nunca é tocado por nada aqui — estas funções só sugerem/avaliam.
 */

/** Mês como string "YYYY-MM-01" (sempre dia 1), pra comparar/somar sem lidar com dia do mês. */
export type Mes = string;

export function mesSeguinte(mes: Mes, quantos: number): Mes {
  const [ano, mesNum] = mes.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mesNum - 1 + quantos, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function indiceDoMes(mes: Mes): number {
  const [ano, mesNum] = mes.split("-").map(Number);
  return ano * 12 + (mesNum - 1);
}

/** mesA <= mesB */
export function mesAteOuIgual(mesA: Mes, mesB: Mes): boolean {
  return indiceDoMes(mesA) <= indiceDoMes(mesB);
}

// --- Precificação por produto -----------------------------------------------------------------

/** Custo = código × fator de custo vigente (hoje o mesmo 2,8× de parametros_multiplicador). */
export function calcularCusto(codigo: number, fatorCusto: number): number {
  return arredondarMoeda(codigo * fatorCusto);
}

/**
 * Preço sugerido = código × fator de venda, arredondado pra terminar em ,90 (quando `arredondar90`),
 * nunca abaixo do piso de entrada.
 */
export function calcularPrecoSugerido(
  codigo: number,
  fatorVenda: number,
  precoPisoEntrada: number,
  arredondar90: boolean,
): number {
  const bruto = codigo * fatorVenda;
  const comNoventa = arredondar90 ? Math.round(bruto - 0.9) + 0.9 : bruto;
  return arredondarMoeda(Math.max(comNoventa, precoPisoEntrada));
}

/** Margem de contribuição teórica, usada quando ainda não há histórico de vendas reais. */
export function margemContribuicaoTeorica(markup: number, despesasVariaveisPct: number): number {
  return 1 - 1 / markup - despesasVariaveisPct;
}

export type MarkupMinimo = { viavel: true; markup: number } | { viavel: false };

/**
 * Markup mínimo pra cobrir despesas variáveis + rateio dos gastos fixos (sobre o faturamento de
 * referência) + a margem de lucro desejada. Denominador <= 0 => meta inviável com os parâmetros
 * atuais (não dá pra atingir o lucro desejado nenhum preço resolve sozinho).
 */
export function calcularMarkupMinimo(
  despesasVariaveisPct: number,
  gastosFixosTotais: number,
  faturamentoReferencia: number,
  lucroDesejadoPct: number,
): MarkupMinimo {
  if (faturamentoReferencia <= 0) return { viavel: false };
  const denominador = 1 - despesasVariaveisPct - gastosFixosTotais / faturamentoReferencia - lucroDesejadoPct;
  if (denominador <= 0) return { viavel: false };
  return { viavel: true, markup: 1 / denominador };
}

export function calcularPrecoMinimo(custo: number, markupMinimo: number): number {
  return arredondarMoeda(custo * markupMinimo);
}

/**
 * Faturamento de referência projetado — só usado quando ainda não existem 3 meses fechados de
 * histórico real de vendas (loja recém-aberta). Tem que descontar o lucro desejado do denominador
 * aqui, não só depois em calcularMarkupMinimo: se não descontar, o termo `gastosFixosTotais /
 * faturamentoReferencia` do markup mínimo vira algebricamente igual à margem teórica inteira, e
 * insistir no lucro desejado POR CIMA disso faz o markup mínimo explodir (teste real: código 8,4,
 * fator 10,1, despesas 10%, lucro 15%, gastos 3.600 -> mínimo R$184 contra um sugerido de R$84 , sem
 * essa correção). Descontando aqui, o resultado converge pro próprio markup padrão (sem dado real
 * ainda, o mínimo vira igual ao sugerido — não tem base pra ser diferente disso).
 */
export function faturamentoReferenciaProjetado(
  gastosFixosTotais: number,
  markupPadrao: number,
  despesasVariaveisPct: number,
  lucroDesejadoPct: number,
): number | null {
  const margem = margemContribuicaoTeorica(markupPadrao, despesasVariaveisPct) - lucroDesejadoPct;
  return margem > 0 ? gastosFixosTotais / margem : null;
}

/** Abaixo disso a venda dá prejuízo direto (nem cobre a despesa variável proporcional). Despesas
 * variáveis em 100% ou mais (config pathológica) tornam qualquer preço insuficiente -- Infinity em
 * vez de um "piso" de 0 silencioso, pra quem chamar poder tratar como "impossível", não "sem piso". */
export function calcularPisoDePrejuizo(custo: number, despesasVariaveisPct: number): number {
  if (despesasVariaveisPct >= 1) return Infinity;
  return arredondarMoeda(custo / (1 - despesasVariaveisPct));
}

export type StatusPreco = "ok" | "abaixo_minimo" | "prejuizo";

export function statusDoPreco(precoAtual: number, precoMinimo: number, pisoDePrejuizo: number): StatusPreco {
  if (precoAtual < pisoDePrejuizo) return "prejuizo";
  if (precoAtual < precoMinimo) return "abaixo_minimo";
  return "ok";
}

// --- Lançamentos recorrentes (gastos, salários, compras parceladas) ---------------------------

export type GastoMensal = { tipo: "mensal"; valor: number; mesInicio: Mes; mesFim: Mes | null };
export type Compra = { tipo: "compra"; valor: number; mesInicio: Mes; parcelas: number };
export type Lancamento = GastoMensal | Compra;

/** Valor de um gasto/compra que recai sobre o mês informado (0 se o mês estiver fora da vigência). */
export function valorNoMes(lancamento: Lancamento, mes: Mes): number {
  if (lancamento.tipo === "mensal") {
    const depoisDoInicio = mesAteOuIgual(lancamento.mesInicio, mes);
    const antesDoFim = lancamento.mesFim === null || mesAteOuIgual(mes, lancamento.mesFim);
    return depoisDoInicio && antesDoFim ? lancamento.valor : 0;
  }
  const fimParcelas = mesSeguinte(lancamento.mesInicio, lancamento.parcelas - 1);
  const dentroDasParcelas = mesAteOuIgual(lancamento.mesInicio, mes) && mesAteOuIgual(mes, fimParcelas);
  return dentroDasParcelas ? arredondarMoeda(lancamento.valor / lancamento.parcelas) : 0;
}

export type MembroEquipe = { salario: number; somarEncargos: boolean; mesInicio: Mes; mesFim: Mes | null };

export function custoMensalMembro(membro: MembroEquipe, encargosCltPct: number): number {
  return membro.somarEncargos ? arredondarMoeda(membro.salario * (1 + encargosCltPct)) : membro.salario;
}

/** Soma dos membros ativos no mês (já aplicando encargos de quem tem `somarEncargos`). */
export function custoEquipeNoMes(equipe: MembroEquipe[], mes: Mes, encargosCltPct: number): number {
  return arredondarMoeda(
    equipe.reduce((soma, m) => {
      const ativo = mesAteOuIgual(m.mesInicio, mes) && (m.mesFim === null || mesAteOuIgual(mes, m.mesFim));
      return ativo ? soma + custoMensalMembro(m, encargosCltPct) : soma;
    }, 0),
  );
}

// --- Faturamento: PDV x vendas manuais ----------------------------------------------------------

export type VendaDoDia = { data: string; faturamento: number; numeroVendas: number };

/** Dia com venda real no PDV ignora a venda manual daquele mesmo dia (o PDV sempre prevalece). */
export function mesclarFaturamentoDiario(vendasPdv: VendaDoDia[], vendasManuais: VendaDoDia[]): VendaDoDia[] {
  const diasComPdv = new Set(vendasPdv.map((v) => v.data));
  return [...vendasPdv, ...vendasManuais.filter((v) => !diasComPdv.has(v.data))];
}

// --- Apuração mensal -------------------------------------------------------------------------

export type EntradaMes = {
  faturamento: number;
  numeroVendas: number;
  custoDasPecas: number;
  despesasVariaveisPct: number;
  // Margem usada só quando faturamento = 0 (mês sem venda nenhuma ainda) -- o chamador passa
  // margemContribuicaoTeorica(markup, despesasVariaveisPct), pra não ignorar o custo da peça
  // (1 - despesasVariaveisPct sozinho super-estimaria a margem, como se não houvesse custo algum).
  margemTeoricaFallback: number;
  gastosMensais: number;
  salarios: number;
  movimentosCaixa: number; // entradas - saídas, já líquido
  compras: number;
};

export type ResultadoMes = {
  faturamento: number;
  numeroVendas: number;
  ticketMedio: number | null;
  custoDasPecas: number;
  devidoAoAtacado: number;
  despesasVariaveis: number;
  gastosMensais: number;
  salarios: number;
  margemContribuicaoPct: number;
  pontoDeEquilibrio: number;
  pontoDeEquilibrioPorDia: number;
  resultado: number;
};

export function calcularMes(entrada: EntradaMes, diasAbertosMes: number): ResultadoMes {
  const { faturamento, numeroVendas, custoDasPecas, despesasVariaveisPct, margemTeoricaFallback, gastosMensais, salarios, compras } = entrada;
  const despesasVariaveis = arredondarMoeda(faturamento * despesasVariaveisPct);
  const margemContribuicaoPct =
    faturamento > 0 ? (faturamento - custoDasPecas - despesasVariaveis) / faturamento : margemTeoricaFallback;
  const pontoDeEquilibrio = margemContribuicaoPct > 0 ? (gastosMensais + salarios) / margemContribuicaoPct : Infinity;
  const resultado = arredondarMoeda(faturamento - custoDasPecas - despesasVariaveis - gastosMensais - salarios);
  void compras; // compras não entram no resultado do mês (só no caixa) — mantido na entrada p/ clareza de contrato
  return {
    faturamento,
    numeroVendas,
    ticketMedio: numeroVendas > 0 ? arredondarMoeda(faturamento / numeroVendas) : null,
    custoDasPecas,
    devidoAoAtacado: custoDasPecas,
    despesasVariaveis,
    gastosMensais,
    salarios,
    margemContribuicaoPct,
    pontoDeEquilibrio,
    pontoDeEquilibrioPorDia: pontoDeEquilibrio / diasAbertosMes,
    resultado,
  };
}

/** Meta de faturamento por dia restante no mês corrente, pra fechar o ponto de equilíbrio. */
export function metaPorDiaRestante(
  pontoDeEquilibrio: number,
  faturamentoAteHoje: number,
  diasCorridosRestantes: number,
  diasAbertosMes: number,
  diasNoMes: number,
): number {
  const faltam = Math.max(0, pontoDeEquilibrio - faturamentoAteHoje);
  const diasAbertosRestantes = Math.max(1, Math.round((diasCorridosRestantes * diasAbertosMes) / diasNoMes));
  return arredondarMoeda(faltam / diasAbertosRestantes);
}

// --- Caixa e investimento ----------------------------------------------------------------------

/**
 * Saldo de caixa no fim do mês M = caixa inicial + soma acumulada de (resultado - compras +
 * movimentos) de todos os meses até M. O investimento inicial NUNCA entra aqui (foi pago antes da
 * abertura, não é saída de caixa da operação) — por isso esta função nem recebe esse valor como
 * parâmetro, pra não ter como alguém somar por engano.
 */
export function saldoDeCaixa(caixaInicial: number, somaResultados: number, somaCompras: number, somaMovimentos: number): number {
  return arredondarMoeda(caixaInicial + somaResultados - somaCompras + somaMovimentos);
}

/** A linha de vigência mais recente com `vigente_desde <= mes` (igual à regra de parametros_multiplicador,
 * mas sem `vigente_ate`: a vigência seguinte é que encerra a anterior, nunca uma data de fim explícita). */
export function vigenteNoMes<T extends { vigente_desde: Mes }>(linhas: readonly T[], mes: Mes): T | null {
  const candidatas = linhas.filter((l) => mesAteOuIgual(l.vigente_desde, mes));
  if (candidatas.length === 0) return null;
  return candidatas.reduce((melhor, atual) => (atual.vigente_desde > melhor.vigente_desde ? atual : melhor));
}

export type Recuperacao = { recuperado: number; percentual: number; falta: number };

export function recuperacaoDoInvestimento(investimentoTotal: number, somaResultados: number): Recuperacao {
  const recuperado = Math.max(0, somaResultados);
  return {
    recuperado: arredondarMoeda(recuperado),
    percentual: investimentoTotal > 0 ? recuperado / investimentoTotal : 0,
    falta: arredondarMoeda(Math.max(0, investimentoTotal - recuperado)),
  };
}
