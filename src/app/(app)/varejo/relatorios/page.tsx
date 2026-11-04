import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { isoEmDias } from "@/lib/datas";
import { RelatoriosVarejoView } from "./relatorios-varejo-view";
import type { PagamentoRelatorio, VendaRelatorio } from "@/lib/relatorios-varejo";

type Perfil = { id: string; nome: string };

export default async function RelatoriosVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="Relatórios do Varejo são restritos a administradores." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO" && !contexto?.dono) {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para ver este relatório." />;
  }

  const supabase = await createClient();
  const desde = isoEmDias(-395);

  const [{ data: vendas }, { data: pagamentos }, { data: perfis }] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, numero, status, total, criada_em, cliente_id, operador_id, clientes(nome)")
      .gte("criada_em", desde)
      .order("criada_em", { ascending: false }),
    supabase
      .from("venda_pagamentos")
      .select("forma, valor, vendas!inner(criada_em, status)")
      .gte("vendas.criada_em", desde),
    supabase.from("profiles").select("id, nome"),
  ]);

  return (
    <RelatoriosVarejoView
      vendas={(vendas ?? []) as unknown as VendaRelatorio[]}
      pagamentos={(pagamentos ?? []) as unknown as (PagamentoRelatorio & { vendas: { criada_em: string; status: string } })[]}
      perfis={(perfis ?? []) as Perfil[]}
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
