"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lerMoeda } from "@/lib/dinheiro";
import { mesSeguinte } from "@/lib/varejo/financeiro";

/**
 * Controle Financeiro do Varejo — CRUD direto nas 6 tabelas (sem RPC: o mesmo padrão já usado em
 * `parametros_multiplicador`), protegido por RLS (admin + operação VAREJO) e auditado por trigger
 * genérico (`auditar_financeiro_varejo`, migration 20261008000001). Nenhuma fórmula financeira mora
 * aqui — isso é tudo em `src/lib/varejo/financeiro.ts` (funções puras); estas actions só gravam/leem.
 */

type ErroPg = { code?: string; message: string };

function mensagem(erro: ErroPg): string {
  if (erro.code === "42501") return "Você não tem permissão para esta ação.";
  if (erro.code === "23505") return "Já existe um lançamento com essas informações (dia duplicado).";
  if (erro.code === "23514") return "Dados incoerentes: confira o tipo e os campos obrigatórios dele.";
  return "Não foi possível concluir. Tente novamente.";
}

function atualizarTelas() {
  revalidatePath("/varejo/financeiro", "layout");
}

async function inserir(tabela: string, valores: Record<string, unknown>): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from(tabela).insert(valores);
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return {};
}

async function editar(tabela: string, id: string, valores: Record<string, unknown>): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from(tabela).update(valores).eq("id", id);
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return {};
}

async function apagar(tabela: string, id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from(tabela).delete().eq("id", id);
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return {};
}

/** "2026-11" (mês) ou "2026-11-05" (dia) -> sempre devolve dia 1 do mês ("2026-11-01") quando for mês. */
function primeiroDiaDoMes(mes: string): string {
  const [ano, mesNum] = mes.split("-");
  return `${ano}-${mesNum}-01`;
}

/** Validação comum a gastos/equipe/movimentos/investimento: um texto obrigatório (descrição ou nome)
 * + um valor em dinheiro maior que zero. Cada lançamento só acrescenta a regra que for exclusiva dele
 * por cima (ex: parcelas em compra parcelada). */
function validarTextoEValor(
  texto: string,
  valorTexto: string,
  rotuloTexto: string,
  rotuloValor = "um valor maior que zero",
): { erro?: string; valor?: number } {
  if (texto.trim() === "") return { erro: `Informe ${rotuloTexto}.` };
  const valor = lerMoeda(valorTexto);
  if (valor === null || valor <= 0) return { erro: `Informe ${rotuloValor}.` };
  return { valor };
}

// --- Configuração (vigência, insert-only) -------------------------------------------------------

export async function criarVigenciaConfig(dados: {
  vigenteDesde: string; // "YYYY-MM"
  fatorVendaPadrao: number;
  fatorVendaMin: number;
  fatorVendaMax: number;
  despesasVariaveisPct: number; // 10 = 10%
  lucroDesejadoPct: number; // 15 = 15%
  diasAbertosMes: number;
  encargosCltPct: number; // 34 = 34%
  caixaInicialTexto: string;
  mesAbertura: string; // "YYYY-MM"
  precoPisoEntradaTexto: string;
  arredondar90: boolean;
}): Promise<{ erro?: string }> {
  const caixaInicial = lerMoeda(dados.caixaInicialTexto) ?? 0;
  const precoPisoEntrada = lerMoeda(dados.precoPisoEntradaTexto);
  if (precoPisoEntrada === null || precoPisoEntrada < 0) return { erro: "Informe o piso de entrada." };
  if (dados.fatorVendaMin > dados.fatorVendaMax) return { erro: "O fator mínimo não pode ser maior que o máximo." };
  if (dados.diasAbertosMes < 1 || dados.diasAbertosMes > 31) return { erro: "Dias abertos no mês inválido." };

  return inserir("varejo_config", {
    vigente_desde: primeiroDiaDoMes(dados.vigenteDesde),
    fator_venda_padrao: dados.fatorVendaPadrao,
    fator_venda_min: dados.fatorVendaMin,
    fator_venda_max: dados.fatorVendaMax,
    despesas_variaveis_pct: dados.despesasVariaveisPct / 100,
    lucro_desejado_pct: dados.lucroDesejadoPct / 100,
    dias_abertos_mes: dados.diasAbertosMes,
    encargos_clt_pct: dados.encargosCltPct / 100,
    caixa_inicial: caixaInicial,
    mes_abertura: primeiroDiaDoMes(dados.mesAbertura),
    preco_piso_entrada: precoPisoEntrada,
    arredondar_90: dados.arredondar90,
  });
}

// --- Gastos (mensais e compras parceladas) --------------------------------------------------------

export type DadosGasto = {
  descricao: string;
  tipo: "mensal" | "compra";
  valorTexto: string;
  mesInicio: string; // "YYYY-MM"
  mesFim: string | null; // só "mensal"
  parcelas: number | null; // só "compra"
};

function validarGasto(dados: DadosGasto): { erro?: string; valor?: number } {
  const v = validarTextoEValor(dados.descricao, dados.valorTexto, "a descrição");
  if (v.erro) return v;
  if (dados.tipo === "compra" && (!dados.parcelas || dados.parcelas < 1)) {
    return { erro: "Compra parcelada precisa do número de parcelas." };
  }
  return v;
}

export async function criarGasto(dados: DadosGasto): Promise<{ erro?: string }> {
  const v = validarGasto(dados);
  if (v.erro) return { erro: v.erro };
  return inserir("varejo_gastos", {
    descricao: dados.descricao.trim(),
    tipo: dados.tipo,
    valor: v.valor,
    mes_inicio: primeiroDiaDoMes(dados.mesInicio),
    mes_fim: dados.tipo === "mensal" && dados.mesFim ? primeiroDiaDoMes(dados.mesFim) : null,
    parcelas: dados.tipo === "compra" ? dados.parcelas : null,
  });
}

export async function editarGasto(id: string, dados: DadosGasto): Promise<{ erro?: string }> {
  const v = validarGasto(dados);
  if (v.erro) return { erro: v.erro };
  return editar("varejo_gastos", id, {
    descricao: dados.descricao.trim(),
    tipo: dados.tipo,
    valor: v.valor,
    mes_inicio: primeiroDiaDoMes(dados.mesInicio),
    mes_fim: dados.tipo === "mensal" && dados.mesFim ? primeiroDiaDoMes(dados.mesFim) : null,
    parcelas: dados.tipo === "compra" ? dados.parcelas : null,
  });
}

export async function apagarGasto(id: string): Promise<{ erro?: string }> {
  return apagar("varejo_gastos", id);
}

// --- Equipe (salários e pró-labore) ---------------------------------------------------------------

export type DadosMembroEquipe = {
  nome: string;
  salarioTexto: string;
  somarEncargos: boolean;
  mesInicio: string;
  mesFim: string | null;
};

function validarMembro(dados: DadosMembroEquipe): { erro?: string; salario?: number } {
  const v = validarTextoEValor(dados.nome, dados.salarioTexto, "o nome", "um salário maior que zero");
  return v.erro ? { erro: v.erro } : { salario: v.valor };
}

export async function criarMembroEquipe(dados: DadosMembroEquipe): Promise<{ erro?: string }> {
  const v = validarMembro(dados);
  if (v.erro) return { erro: v.erro };
  return inserir("varejo_equipe", {
    nome: dados.nome.trim(),
    salario: v.salario,
    somar_encargos: dados.somarEncargos,
    mes_inicio: primeiroDiaDoMes(dados.mesInicio),
    mes_fim: dados.mesFim ? primeiroDiaDoMes(dados.mesFim) : null,
  });
}

export async function editarMembroEquipe(id: string, dados: DadosMembroEquipe): Promise<{ erro?: string }> {
  const v = validarMembro(dados);
  if (v.erro) return { erro: v.erro };
  return editar("varejo_equipe", id, {
    nome: dados.nome.trim(),
    salario: v.salario,
    somar_encargos: dados.somarEncargos,
    mes_inicio: primeiroDiaDoMes(dados.mesInicio),
    mes_fim: dados.mesFim ? primeiroDiaDoMes(dados.mesFim) : null,
  });
}

export async function apagarMembroEquipe(id: string): Promise<{ erro?: string }> {
  return apagar("varejo_equipe", id);
}

// --- Movimentos de caixa (fora de venda) ---------------------------------------------------------

export type DadosMovimentoCaixa = { data: string; tipo: "entrada" | "saida"; descricao: string; valorTexto: string };

function validarMovimento(dados: DadosMovimentoCaixa): { erro?: string; valor?: number } {
  return validarTextoEValor(dados.descricao, dados.valorTexto, "a descrição");
}

export async function criarMovimentoCaixa(dados: DadosMovimentoCaixa): Promise<{ erro?: string }> {
  const v = validarMovimento(dados);
  if (v.erro) return { erro: v.erro };
  return inserir("varejo_movimentos_caixa", { data: dados.data, tipo: dados.tipo, descricao: dados.descricao.trim(), valor: v.valor });
}

export async function editarMovimentoCaixa(id: string, dados: DadosMovimentoCaixa): Promise<{ erro?: string }> {
  const v = validarMovimento(dados);
  if (v.erro) return { erro: v.erro };
  return editar("varejo_movimentos_caixa", id, { data: dados.data, tipo: dados.tipo, descricao: dados.descricao.trim(), valor: v.valor });
}

export async function apagarMovimentoCaixa(id: string): Promise<{ erro?: string }> {
  return apagar("varejo_movimentos_caixa", id);
}

// --- Investimento inicial -------------------------------------------------------------------------

export type DadosInvestimentoInicial = { data: string; descricao: string; valorTexto: string };

function validarInvestimento(dados: DadosInvestimentoInicial): { erro?: string; valor?: number } {
  return validarTextoEValor(dados.descricao, dados.valorTexto, "a descrição");
}

export async function criarInvestimentoInicial(dados: DadosInvestimentoInicial): Promise<{ erro?: string }> {
  const v = validarInvestimento(dados);
  if (v.erro) return { erro: v.erro };
  return inserir("varejo_investimento_inicial", { data: dados.data, descricao: dados.descricao.trim(), valor: v.valor });
}

export async function editarInvestimentoInicial(id: string, dados: DadosInvestimentoInicial): Promise<{ erro?: string }> {
  const v = validarInvestimento(dados);
  if (v.erro) return { erro: v.erro };
  return editar("varejo_investimento_inicial", id, { data: dados.data, descricao: dados.descricao.trim(), valor: v.valor });
}

export async function apagarInvestimentoInicial(id: string): Promise<{ erro?: string }> {
  return apagar("varejo_investimento_inicial", id);
}

// --- Vendas manuais (só dia sem PDV, ou importação) -----------------------------------------------

export type DadosVendaManual = { data: string; faturamentoTexto: string; numeroVendas: number };

function validarVendaManual(dados: DadosVendaManual): { erro?: string; faturamento?: number } {
  const faturamento = lerMoeda(dados.faturamentoTexto);
  if (faturamento === null || faturamento < 0) return { erro: "Informe o faturamento do dia." };
  if (!Number.isInteger(dados.numeroVendas) || dados.numeroVendas < 0) return { erro: "Informe o número de vendas." };
  return { faturamento };
}

export async function criarVendaManual(dados: DadosVendaManual): Promise<{ erro?: string }> {
  const v = validarVendaManual(dados);
  if (v.erro) return { erro: v.erro };
  return inserir("varejo_vendas_manuais", { data: dados.data, faturamento: v.faturamento, numero_vendas: dados.numeroVendas, origem: "manual" });
}

export async function editarVendaManual(id: string, dados: DadosVendaManual): Promise<{ erro?: string }> {
  const v = validarVendaManual(dados);
  if (v.erro) return { erro: v.erro };
  return editar("varejo_vendas_manuais", id, { data: dados.data, faturamento: v.faturamento, numero_vendas: dados.numeroVendas });
}

export async function apagarVendaManual(id: string): Promise<{ erro?: string }> {
  return apagar("varejo_vendas_manuais", id);
}

/** Dias do mês (VAREJO) que já têm venda real no PDV — usado pra avisar na tela de venda manual
 * que o PDV vai prevalecer, igual à regra do motor (mesclarFaturamentoDiario). */
export async function diasComVendaNoPdv(mes: string): Promise<string[]> {
  const supabase = await createClient();
  const inicio = primeiroDiaDoMes(mes);
  const { data } = await supabase
    .from("vendas")
    .select("criada_em")
    .eq("status", "concluida")
    .gte("criada_em", inicio)
    .lt("criada_em", mesSeguinte(inicio, 1));
  const dias = new Set((data ?? []).map((v) => (v.criada_em as string).slice(0, 10)));
  return [...dias];
}

// --- Importação do controle antigo (idempotente por dia/chave) -------------------------------------

type JsonControleAntigo = {
  config?: { fcusto?: number; markup: number; vari: number; dias: number; enc: number; caixaInicial: number; abertura: string };
  gastos?: { id: string; desc: string; tipo: "mensal" | "compra"; valor: number; inicio: string; fim?: string; parcelas?: number }[];
  equipe?: { id: string; nome: string; salario: number; clt: boolean; inicio: string; fim?: string }[];
  movimentos?: { id: string; data: string; tipo: "aporte" | "retirada"; desc: string; valor: number }[];
  investimentos?: { id: string; data: string; desc: string; valor: number }[];
  vendas?: { id: string; data: string; fat: number; nv: number }[];
};

/** Idempotente: reexecutar não duplica (vendas por `unique(operacao_id, data)`, upsert; o resto não
 * tem uma chave natural tão forte no banco, então reimportar gera duplicata de gasto/equipe/movimento
 * -- o dono deve rodar isso uma vez só por fonte. Vendas (a parte que mais importa reexecutar sem
 * medo, por ser recorrente) está coberta. */
export async function importarControleAntigo(jsonTexto: string): Promise<{ erro?: string; resumo?: string }> {
  let json: JsonControleAntigo;
  try {
    json = JSON.parse(jsonTexto);
  } catch {
    return { erro: "JSON inválido." };
  }

  const supabase = await createClient();
  const partes: string[] = [];

  if (json.config) {
    const fcusto = json.config.fcusto ?? 2.8;
    const r = await criarVigenciaConfig({
      vigenteDesde: json.config.abertura,
      fatorVendaPadrao: json.config.markup * fcusto,
      fatorVendaMin: 9.0,
      fatorVendaMax: 11.2,
      despesasVariaveisPct: json.config.vari,
      lucroDesejadoPct: 15,
      diasAbertosMes: json.config.dias,
      encargosCltPct: json.config.enc,
      caixaInicialTexto: String(json.config.caixaInicial),
      mesAbertura: json.config.abertura,
      precoPisoEntradaTexto: "19.90",
      arredondar90: true,
    });
    if (r.erro) return { erro: `Config: ${r.erro}` };
    partes.push("configuração importada");
  }

  for (const g of json.gastos ?? []) {
    const r = await criarGasto({
      descricao: g.desc,
      tipo: g.tipo,
      valorTexto: String(g.valor),
      mesInicio: g.inicio,
      mesFim: g.fim || null,
      parcelas: g.parcelas ?? null,
    });
    if (r.erro) return { erro: `Gasto "${g.desc}": ${r.erro}` };
  }
  if (json.gastos?.length) partes.push(`${json.gastos.length} gasto(s)`);

  for (const m of json.equipe ?? []) {
    const r = await criarMembroEquipe({
      nome: m.nome,
      salarioTexto: String(m.salario),
      somarEncargos: m.clt,
      mesInicio: m.inicio,
      mesFim: m.fim || null,
    });
    if (r.erro) return { erro: `Equipe "${m.nome}": ${r.erro}` };
  }
  if (json.equipe?.length) partes.push(`${json.equipe.length} membro(s) da equipe`);

  for (const mv of json.movimentos ?? []) {
    const r = await criarMovimentoCaixa({
      data: mv.data,
      tipo: mv.tipo === "aporte" ? "entrada" : "saida",
      descricao: mv.desc || (mv.tipo === "aporte" ? "Aporte" : "Retirada"),
      valorTexto: String(mv.valor),
    });
    if (r.erro) return { erro: `Movimento de ${mv.data}: ${r.erro}` };
  }
  if (json.movimentos?.length) partes.push(`${json.movimentos.length} movimento(s) de caixa`);

  for (const inv of json.investimentos ?? []) {
    const r = await criarInvestimentoInicial({ data: inv.data, descricao: inv.desc, valorTexto: String(inv.valor) });
    if (r.erro) return { erro: `Investimento de ${inv.data}: ${r.erro}` };
  }
  if (json.investimentos?.length) partes.push(`${json.investimentos.length} investimento(s) inicial(is)`);

  // Vendas: idempotente de verdade — a chave natural é o dia (unique por operação); reexecutar o
  // import só atualiza a linha existente em vez de duplicar ou falhar no unique.
  for (const v of json.vendas ?? []) {
    const { data: existente } = await supabase.from("varejo_vendas_manuais").select("id").eq("data", v.data).maybeSingle();
    const valores = { data: v.data, faturamento: v.fat, numero_vendas: v.nv, origem: "importacao", origem_id: v.id };
    const { error } = existente
      ? await supabase.from("varejo_vendas_manuais").update(valores).eq("id", existente.id)
      : await supabase.from("varejo_vendas_manuais").insert(valores);
    if (error) return { erro: `Venda de ${v.data}: ${mensagem(error)}` };
  }
  if (json.vendas?.length) partes.push(`${json.vendas.length} venda(s) manual(is)`);

  atualizarTelas();
  return { resumo: partes.length ? `Importado: ${partes.join(", ")}.` : "Nada para importar." };
}

// --- Dívidas com o Atacado (lançadas no cadastro da peça, migration 20261009000001) ----------------
// Só a baixa/reabertura mora aqui -- a criação acontece junto do cadastro da peça
// (registrar_compra_atacado_varejo, chamado por cadastrarPecaCatalogo em actions/varejo.ts).

export async function marcarDividaAtacado(id: string, pago: boolean): Promise<{ erro?: string }> {
  return editar("varejo_dividas_atacado", id, { status: pago ? "pago" : "em_aberto", pago_em: pago ? new Date().toISOString() : null });
}
