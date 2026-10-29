import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { hojeIso, isoEmDias, dataLocalDoTimestamptz, inicioDaSemanaIso, inicioDoMesIso } from "@/lib/datas";
import { PdvVarejoView } from "./pdv-varejo-view";
import type { ConfigFinanceira, CupomVarejo, ItemCatalogo, MetaDoDia, SessaoCaixa, Supervisor, VendaDaSessao } from "@/lib/varejo/tipos";

// Venda do varejo: custo e margem NUNCA aparecem aqui, em nenhuma hipótese — regra do módulo de
// varejo, independente do papel. As views do banco (pdv_catalogo, minha_sessao_caixa,
// pdv_supervisores) já não têm coluna de custo; nada aqui lê movimentos_estoque/venda_itens.
export default async function PdvVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin" && perfil.papel !== "vendedor") {
    return <AvisoAcesso texto="Você não tem permissão para acessar o PDV do varejo." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO" && !contexto?.dono) {
    return <AvisoAcesso texto="Troque para a operação Varejo (seletor no topo) para acessar o PDV." />;
  }

  const supabase = await createClient();
  const hoje = hojeIso();
  const inicioSemana = inicioDaSemanaIso(hoje);
  const inicioMes = inicioDoMesIso(hoje);
  // Janela larga o bastante pra cobrir os ultimos 7 dias (grafico) E o inicio do mes atual (meta
  // mensal) -- a mais antiga das duas datas, com 1 dia de margem pra nunca perder venda de
  // madrugada no agrupamento por dia local feito em JS logo abaixo (dataLocalDoTimestamptz).
  const inicioBusca = [isoEmDias(-8), inicioMes].sort()[0];
  const inicioJanela = `${inicioBusca}T00:00:00-03:00`;
  const [{ data: sessao }, { data: catalogo }, { data: supervisores }, { data: vendas }, { data: cupons }, { data: configs }, { data: vendasRecentes }] =
    await Promise.all([
      supabase.from("minha_sessao_caixa").select("*").maybeSingle(),
      supabase.from("pdv_catalogo").select("*").order("nome"),
      supabase.from("pdv_supervisores").select("*").order("nome"),
      // Vendas da sessao aberta do proprio operador (pdv_vendas ja filtra por minha_sessao_caixa) —
      // sem isso nao havia como ver uma venda pra poder cancelar (achado no code review, 2026-09-22).
      supabase.from("pdv_vendas").select("*").order("criada_em", { ascending: false }),
      // Cupons carregam inteiros na tela (mesmo espírito do PDV Eventos) — aplicar procura na lista já
      // em memória, sem ida ao servidor no meio da venda.
      supabase.from("cupons_varejo").select("*").order("criado_em", { ascending: false }),
      supabase.from("varejo_config").select("*").order("vigente_desde", { ascending: false }),
      // Painel "Meta do dia": faturamento da loja inteira (todas as sessoes, nao so a do operador
      // atual) — a RLS de `vendas` ja libera isso pra qualquer papel autenticado na operacao (so
      // `pdv_vendas` estreita pra sessao propria, de proposito, pra outro uso). So criada_em/total —
      // custo e margem nunca aparecem no PDV, em nenhuma hipotese (regra do modulo).
      supabase.from("vendas").select("criada_em, total").eq("status", "concluida").gte("criada_em", inicioJanela),
    ]);

  const configVigente = (configs ?? []).find((c) => (c.vigente_desde as string) <= hoje) as ConfigFinanceira | undefined;

  const porDia = new Map<string, number>();
  let faturamentoSemana = 0;
  let faturamentoMes = 0;
  for (const v of vendasRecentes ?? []) {
    const dia = dataLocalDoTimestamptz(v.criada_em as string);
    const total = v.total as number;
    porDia.set(dia, (porDia.get(dia) ?? 0) + total);
    if (dia >= inicioSemana) faturamentoSemana += total;
    if (dia >= inicioMes) faturamentoMes += total;
  }
  const ultimosDias = Array.from({ length: 7 }, (_, i) => {
    const data = isoEmDias(-(6 - i));
    return { data, total: porDia.get(data) ?? 0 };
  });
  const metaDoDia: MetaDoDia = {
    metaDiaria: configVigente?.meta_diaria ?? 500,
    faturamentoHoje: porDia.get(hoje) ?? 0,
    vendasHoje: (vendasRecentes ?? []).filter((v) => dataLocalDoTimestamptz(v.criada_em as string) === hoje).length,
    ultimosDias,
    metaSemanal: configVigente?.meta_semanal ?? 3000,
    faturamentoSemana,
    metaMensal: configVigente?.meta_mensal ?? 13000,
    faturamentoMes,
  };

  return (
    <PdvVarejoView
      sessao={sessao as SessaoCaixa | null}
      catalogo={(catalogo ?? []) as ItemCatalogo[]}
      supervisores={(supervisores ?? []) as Supervisor[]}
      vendas={(vendas ?? []) as VendaDaSessao[]}
      cupons={(cupons ?? []) as CupomVarejo[]}
      metaDoDia={metaDoDia}
      podeEditarMetas={perfil.papel === "admin"}
    />
  );
}

function AvisoAcesso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
