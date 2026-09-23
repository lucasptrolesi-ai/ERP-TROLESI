import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { hojeIso, isoEmDias } from "@/lib/datas";
import { KpiCard } from "@/components/kpi-card";
import { GraficoComparativoMensal } from "@/components/dashboard/grafico-comparativo-mensal";
import type { RelatorioConsolidadoMensal, RelatorioConsolidadoPeriodo } from "@/lib/dashboard-tipos";

export default async function ConsolidadoPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return <Aviso texto="O painel consolidado é restrito a administradores." />;
  }

  const supabase = await createClient();
  const [{ data: mensal }, { data: periodo }] = await Promise.all([
    supabase.rpc("relatorio_consolidado_mensal", { p_meses: 6 }),
    supabase.rpc("relatorio_consolidado", { p_inicio: isoEmDias(-180), p_fim: hojeIso() }),
  ]);

  const relatorioMensal = mensal as RelatorioConsolidadoMensal | null;
  const relatorioPeriodo = periodo as RelatorioConsolidadoPeriodo | null;

  if (!relatorioMensal || !relatorioPeriodo) {
    return <Aviso texto="Não foi possível carregar o painel agora. Tente novamente em instantes." />;
  }

  const { consolidado } = relatorioPeriodo;
  const totalAtacado = relatorioMensal.meses.reduce((s, m) => s + m.atacado, 0);
  const totalVarejo = relatorioMensal.meses.reduce((s, m) => s + m.varejo, 0);
  const totalGeral = totalAtacado + totalVarejo;
  const fatiaVarejo = totalGeral > 0 ? Math.round((totalVarejo / totalGeral) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Painel Consolidado</h1>
        <p className="text-sm text-text-soft">
          Atacado + Varejo, últimos 6 meses — elimina a transferência intercompany entre as duas operações
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Faturamento consolidado" valor={formatarMoeda(consolidado.receita)} nota="intercompany eliminado" />
        <KpiCard label="Fatia Varejo" valor={`${fatiaVarejo}%`} nota="do faturamento nos últimos 6 meses" />
        <KpiCard
          label="A receber (grupo)"
          valor={formatarMoeda(consolidado.a_receber)}
          nota={consolidado.a_receber > 0 ? "títulos em aberto, sem intercompany" : "tudo quitado"}
          tom={consolidado.a_receber > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="A pagar (grupo)"
          valor={formatarMoeda(consolidado.a_pagar)}
          nota={consolidado.a_pagar > 0 ? "títulos em aberto, sem intercompany" : "tudo quitado"}
          tom={consolidado.a_pagar > 0 ? "warn" : "ok"}
        />
      </div>

      <GraficoComparativoMensal dados={relatorioMensal.meses} />

      {(consolidado.intercompany_eliminado_a_receber > 0 || consolidado.intercompany_eliminado_a_pagar > 0) && (
        <p className="rounded-[14px] border border-line bg-rose-soft p-3 text-xs text-text-soft">
          Eliminado do consolidado: {formatarMoeda(consolidado.intercompany_eliminado_a_receber)} a receber e{" "}
          {formatarMoeda(consolidado.intercompany_eliminado_a_pagar)} a pagar entre Atacado e Varejo (transferência de
          estoque) — não é receita nem custo de verdade pro grupo.
        </p>
      )}
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
