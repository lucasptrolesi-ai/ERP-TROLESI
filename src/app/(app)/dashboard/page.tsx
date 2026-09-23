import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { KpiCard } from "@/components/kpi-card";
import { GraficoFaturamentoMensal } from "@/components/dashboard/grafico-faturamento-mensal";
import { GraficoFormasPagamento } from "@/components/dashboard/grafico-formas-pagamento";
import { ListaTopProdutos } from "@/components/dashboard/lista-top-produtos";
import type { RelatorioAtacadoDashboard } from "@/lib/dashboard-tipos";

export default async function DashboardAtacadoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="O painel do Atacado é restrito a administradores." />;
  }
  if (contexto?.operacao_codigo !== "ATACADO") {
    return <Aviso texto="Troque para a operação Atacado (seletor no topo) para ver este painel." />;
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("relatorio_atacado_dashboard", { p_meses: 6 });
  const relatorio = data as RelatorioAtacadoDashboard | null;

  if (!relatorio) {
    return <Aviso texto="Não foi possível carregar o painel agora. Tente novamente em instantes." />;
  }

  const totalPeriodo = relatorio.faturamento_mensal.reduce((s, m) => s + m.total, 0);
  const pedidosPeriodo = relatorio.faturamento_mensal.reduce((s, m) => s + m.pedidos, 0);
  const ticketMedio = pedidosPeriodo > 0 ? totalPeriodo / pedidosPeriodo : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Painel Atacado</h1>
        <p className="text-sm text-text-soft">Últimos 6 meses de pedidos faturados</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Faturamento (6 meses)" valor={formatarMoeda(totalPeriodo)} nota={`${pedidosPeriodo} pedidos faturados`} />
        <KpiCard label="Ticket médio" valor={formatarMoeda(ticketMedio)} nota="por pedido faturado" />
        <KpiCard
          label="A receber em aberto"
          valor={formatarMoeda(relatorio.receber_aberto)}
          nota={relatorio.receber_aberto > 0 ? "títulos em aberto" : "tudo quitado"}
          tom={relatorio.receber_aberto > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="A pagar em aberto"
          valor={formatarMoeda(relatorio.pagar_aberto)}
          nota={relatorio.pagar_aberto > 0 ? "títulos em aberto" : "tudo quitado"}
          tom={relatorio.pagar_aberto > 0 ? "warn" : "ok"}
        />
      </div>

      <GraficoFaturamentoMensal dados={relatorio.faturamento_mensal} />

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
