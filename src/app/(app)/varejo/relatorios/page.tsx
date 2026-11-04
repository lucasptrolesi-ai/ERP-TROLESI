import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { isoEmDias } from "@/lib/datas";
import { RelatoriosVarejoView } from "./relatorios-varejo-view";
import type { DividaAtacadoRelatorio, PagamentoRelatorio, VendaRelatorio } from "@/lib/relatorios-varejo";

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

  const [{ data: vendas }, { data: pagamentos }, { data: perfis }, { data: dividasPeriodo }, { data: dividasEmAberto }] =
    await Promise.all([
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
      // Código do Atacado por venda (pros cards/tabelas do período) -- origem venda, não compra
      // (ver src/lib/relatorios-varejo.ts). Não filtra por status: "código vendido" conta
      // independente de a dívida já ter sido paga depois.
      supabase
        .from("varejo_dividas_atacado")
        .select("codigo_atacado, quantidade, venda_itens(venda_id)")
        .not("venda_item_id", "is", null)
        .gte("criado_em", desde),
      // Saldo em aberto com o Atacado (R$) -- saldo CORRENTE, sem limite de data: pagar a dívida
      // não tem relação com quando a venda foi feita, uma dívida de fora da janela de 13 meses
      // ainda conta se continuar em_aberto. Só origem venda (venda_item_id) -- as peças chegam no
      // Varejo em consignação, então só vira dívida de verdade quando é VENDIDA, nunca só por
      // estar cadastrada/em estoque (decisão do usuário, 2026-11-04). As ~164 linhas antigas com
      // movimento_estoque_id são do modelo anterior (dívida no cadastro/compra de estoque),
      // descontinuado na migration 20261026000001 -- não entram nesse saldo.
      supabase
        .from("varejo_dividas_atacado")
        .select("status, custo_total")
        .eq("status", "em_aberto")
        .not("venda_item_id", "is", null),
    ]);

  return (
    <RelatoriosVarejoView
      vendas={(vendas ?? []) as unknown as VendaRelatorio[]}
      pagamentos={(pagamentos ?? []) as unknown as (PagamentoRelatorio & { vendas: { criada_em: string; status: string } })[]}
      perfis={(perfis ?? []) as Perfil[]}
      dividasPeriodo={(dividasPeriodo ?? []) as unknown as DividaAtacadoRelatorio[]}
      dividasEmAberto={(dividasEmAberto ?? []) as { status: string; custo_total: number }[]}
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
