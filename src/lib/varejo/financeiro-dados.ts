import { createClient } from "@/lib/supabase/server";
import { calcularMarkupMinimo, custoEquipeNoMes, faturamentoReferenciaProjetado, mesSeguinte, valorNoMes, vigenteNoMes, type MarkupMinimo } from "@/lib/varejo/financeiro";
import type { ConfigFinanceira, GastoVarejo, MembroEquipeVarejo } from "@/lib/varejo/tipos";

export type CalculadoraPreco = { fatorCusto: number; config: ConfigFinanceira; markupMinimo: MarkupMinimo };

type Multiplicador = { valor: number; vigente_de: string; vigente_ate: string | null };

/** Dados já lidos por quem chama (ex: a página do Controle Financeiro, que já fez essas 4 consultas
 * no próprio Promise.all) — evita consultar as mesmas 4 tabelas de novo na mesma requisição. Quem
 * não os tem à mão (ex: o cadastro do catálogo) simplesmente omite e esta function busca sozinha. */
type DadosPreCarregados = {
  configs: ConfigFinanceira[] | null;
  gastos: GastoVarejo[] | null;
  equipe: MembroEquipeVarejo[] | null;
  multiplicadores: Multiplicador[] | null;
};

/**
 * Config vigente + fator de custo vigente + markup mínimo do mês atual — usado tanto pela
 * calculadora de preço no cadastro (`/varejo/catalogo`) quanto pela tela "Revisar preços"
 * (`/varejo/financeiro`), pra não duplicar a conta em dois lugares (regra 4 do módulo: motor único).
 * Admin-only por natureza (quem chama já filtra por papel antes).
 */
export async function buscarCalculadoraPreco(
  supabase: Awaited<ReturnType<typeof createClient>>,
  preCarregados?: DadosPreCarregados,
): Promise<CalculadoraPreco | null> {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

  const { configs, gastos, equipe, multiplicadores } =
    preCarregados ??
    (await (async () => {
      const [{ data: configs }, { data: multiplicadores }, { data: gastos }, { data: equipe }] = await Promise.all([
        supabase.from("varejo_config").select("*").order("vigente_desde"),
        supabase.from("parametros_multiplicador").select("valor, vigente_de, vigente_ate").eq("chave", "TRANSFERENCIA_ATACADO_VAREJO"),
        supabase.from("varejo_gastos").select("*"),
        supabase.from("varejo_equipe").select("*"),
      ]);
      return { configs, multiplicadores, gastos, equipe } as DadosPreCarregados;
    })());
  if (!configs || configs.length === 0) return null;

  const config = vigenteNoMes(configs, mesAtual);
  if (!config) return null;

  const fatorCusto = (multiplicadores ?? []).find((m) => m.vigente_de <= mesAtual && (!m.vigente_ate || m.vigente_ate >= mesAtual))?.valor ?? 2.8;

  const gastosFixosTotais =
    (gastos ?? [])
      .filter((g) => g.tipo === "mensal")
      .reduce((s, g) => s + valorNoMes({ tipo: "mensal", valor: g.valor, mesInicio: g.mes_inicio, mesFim: g.mes_fim }, mesAtual), 0) +
    custoEquipeNoMes(
      (equipe ?? []).map((m) => ({ salario: m.salario, somarEncargos: m.somar_encargos, mesInicio: m.mes_inicio, mesFim: m.mes_fim })),
      mesAtual,
      config.encargos_clt_pct,
    );

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
      : faturamentoReferenciaProjetado(gastosFixosTotais, config.fator_venda_padrao / fatorCusto, config.despesas_variaveis_pct, config.lucro_desejado_pct);

  const markupMinimo =
    faturamentoReferencia === null
      ? ({ viavel: false } as const)
      : calcularMarkupMinimo(config.despesas_variaveis_pct, gastosFixosTotais, faturamentoReferencia, config.lucro_desejado_pct);

  return { fatorCusto, config, markupMinimo };
}
