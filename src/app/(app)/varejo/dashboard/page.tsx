import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { KpiCard } from "@/components/kpi-card";
import { GraficoMovimentoVendas } from "@/components/grafico-movimento-vendas";
import { GraficoFormasPagamento } from "@/components/dashboard/grafico-formas-pagamento";
import { ListaTopProdutos } from "@/components/dashboard/lista-top-produtos";
import type { RelatorioVarejoDashboard } from "@/lib/dashboard-tipos";

export default async function DashboardVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="O painel do Varejo é restrito a administradores." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para ver este painel." />;
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("relatorio_varejo_dashboard", { p_dias: 14 });
  const relatorio = data as RelatorioVarejoDashboard | null;

  if (!relatorio) {
    return <Aviso texto="Não foi possível carregar o painel agora. Tente novamente em instantes." />;
  }

  const totalPeriodo = relatorio.faturamento_diario.reduce((s, d) => s + d.total, 0);
  const vendasPeriodo = relatorio.faturamento_diario.reduce((s, d) => s + d.vendas, 0);
  const ticketMedio = vendasPeriodo > 0 ? totalPeriodo / vendasPeriodo : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Painel Varejo</h1>
        <p className="text-sm text-text-soft">Últimos 14 dias de vendas concluídas</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Faturamento (14 dias)" valor={formatarMoeda(totalPeriodo)} nota={`${vendasPeriodo} vendas`} />
        <KpiCard label="Ticket médio" valor={formatarMoeda(ticketMedio)} nota="por venda" />
        <KpiCard
          label="Sessões de caixa"
          valor={String(relatorio.sessoes_periodo)}
          nota={relatorio.divergencia_total > 0 ? `${formatarMoeda(relatorio.divergencia_total)} em divergência` : "sem divergência"}
          tom={relatorio.divergencia_total > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="A pagar (intercompany)"
          valor={formatarMoeda(relatorio.pagar_aberto)}
          nota={relatorio.pagar_aberto > 0 ? "transferências em aberto" : "tudo quitado"}
          tom={relatorio.pagar_aberto > 0 ? "warn" : "ok"}
        />
      </div>

      <GraficoMovimentoVendas dados={relatorio.faturamento_diario.map((d) => ({ data: d.dia, valor: d.total }))} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListaTopProdutos dados={relatorio.top_produtos} />
        <GraficoFormasPagamento dados={relatorio.formas_pagamento} />
      </div>
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
