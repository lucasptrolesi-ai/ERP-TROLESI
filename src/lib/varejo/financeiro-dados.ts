import { createClient } from "@/lib/supabase/server";
import { calcularMarkupMinimo, margemContribuicaoTeorica, mesSeguinte, valorNoMes, vigenteNoMes, type MarkupMinimo } from "@/lib/varejo/financeiro";
import type { ConfigFinanceira } from "@/lib/varejo/tipos";

export type CalculadoraPreco = { fatorCusto: number; config: ConfigFinanceira; markupMinimo: MarkupMinimo };

/**
 * Config vigente + fator de custo vigente + markup mínimo do mês atual — usado tanto pela
 * calculadora de preço no cadastro (`/varejo/catalogo`) quanto pela tela "Revisar preços"
 * (`/varejo/financeiro`), pra não duplicar a conta em dois lugares (regra 4 do módulo: motor único).
 * Admin-only por natureza (quem chama já filtra por papel antes).
 */
export async function buscarCalculadoraPreco(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CalculadoraPreco | null> {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: configs }, { data: multiplicadores }, { data: gastos }, { data: equipe }] = await Promise.all([
    supabase.from("varejo_config").select("*").order("vigente_desde"),
    supabase.from("parametros_multiplicador").select("valor, vigente_de, vigente_ate").eq("chave", "TRANSFERENCIA_ATACADO_VAREJO"),
    supabase.from("varejo_gastos").select("*"),
    supabase.from("varejo_equipe").select("*"),
  ]);
  if (!configs || configs.length === 0) return null;

  const config = vigenteNoMes(configs as ConfigFinanceira[], mesAtual);
  if (!config) return null;

  const fatorCusto = (multiplicadores ?? []).find((m) => m.vigente_de <= mesAtual && (!m.vigente_ate || m.vigente_ate >= mesAtual))?.valor ?? 2.8;

  const gastosFixosTotais =
    (gastos ?? [])
      .filter((g) => g.tipo === "mensal")
      .reduce((s, g) => s + valorNoMes({ tipo: "mensal", valor: g.valor, mesInicio: g.mes_inicio, mesFim: g.mes_fim }, mesAtual), 0) +
    (equipe ?? []).reduce((s, m) => s + (m.somar_encargos ? m.salario * (1 + config.encargos_clt_pct) : m.salario), 0);

  // Faturamento de referência: média dos últimos 3 meses fechados (PDV + vendas manuais); sem
  // nenhum mês fechado com dado ainda (loja recém-aberta), usa o ponto de equilíbrio projetado.
  const tresMesesAtras = mesSeguinte(mesAtual, -3);
  const [{ data: vendasRecentes }, { data: manuaisRecentes }] = await Promise.all([
    supabase.from("vendas").select("criada_em, total").eq("status", "concluida").gte("criada_em", tresMesesAtras).lt("criada_em", mesAtual),
    supabase.from("varejo_vendas_manuais").select("data, faturamento").gte("data", tresMesesAtras).lt("data", mesAtual),
  ]);
  const porMes = new Map<string, number>();
  for (const v of vendasRecentes ?? []) {
    const mes = (v.criada_em as string).slice(0, 7);
    porMes.set(mes, (porMes.get(mes) ?? 0) + (v.total as number));
  }
  for (const v of manuaisRecentes ?? []) {
    const mes = (v.data as string).slice(0, 7);
    if (!vendasRecentes?.some((x) => (x.criada_em as string).slice(0, 7) === mes)) {
      porMes.set(mes, (porMes.get(mes) ?? 0) + v.faturamento);
    }
  }
  const valoresMensais = [...porMes.values()];
  const faturamentoReferencia =
    valoresMensais.length > 0
      ? valoresMensais.reduce((s, v) => s + v, 0) / valoresMensais.length
      : gastosFixosTotais / margemContribuicaoTeorica(config.fator_venda_padrao / fatorCusto, config.despesas_variaveis_pct);

  const markupMinimo = calcularMarkupMinimo(config.despesas_variaveis_pct, gastosFixosTotais, faturamentoReferencia, config.lucro_desejado_pct);

  return { fatorCusto, config, markupMinimo };
}
