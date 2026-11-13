import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { isoEmDias } from "@/lib/datas";
import { RelatoriosVarejoView } from "./relatorios-varejo-view";
import type { ItemComCodigoAtacado, PagamentoRelatorio, VendaRelatorio } from "@/lib/relatorios-varejo";

// Forma crua da query (antes de achatar/resolver o nome da peça) -- mesmo
// jeito de catalogo_variacoes/venda_itens embutido que financeiro/page.tsx já
// usa pra essa mesma tabela; o cliente supabase-js às vezes devolve essas
// relações to-one como array de 1, então trata os dois formatos.
type DividaBruta = {
  id: string;
  codigo_atacado: number;
  quantidade: number;
  custo_total: number;
  venda_itens: { venda_id: string; descricao_manual: string | null } | { venda_id: string; descricao_manual: string | null }[] | null;
  catalogo_variacoes: { catalogo_produtos: { nome: string } | { nome: string }[] | null } | { catalogo_produtos: { nome: string } | { nome: string }[] | null }[] | null;
};

function primeiro<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

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
      // Peças vendidas com código do Atacado (pros cards/tabelas do período) -- origem venda, não
      // compra (ver src/lib/relatorios-varejo.ts). Não filtra por status: "código vendido" conta
      // independente de a dívida já ter sido paga depois.
      supabase
        .from("varejo_dividas_atacado")
        .select("id, codigo_atacado, quantidade, custo_total, venda_itens(venda_id, descricao_manual), catalogo_variacoes(catalogo_produtos(nome))")
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

  const itensAtacado: ItemComCodigoAtacado[] = ((dividasPeriodo ?? []) as unknown as DividaBruta[]).map((d) => {
    const vendaItem = primeiro(d.venda_itens);
    const variacao = primeiro(d.catalogo_variacoes);
    const produto = variacao ? primeiro(variacao.catalogo_produtos) : null;
    return {
      id: d.id,
      // Item manual (fora do catálogo) não tem peça cadastrada -- usa a descrição digitada no PDV.
      produto_nome: produto?.nome ?? vendaItem?.descricao_manual ?? "(item removido)",
      codigo_atacado: d.codigo_atacado,
      quantidade: d.quantidade,
      custo_total: d.custo_total,
      venda_id: vendaItem?.venda_id ?? null,
    };
  });

  return (
    <RelatoriosVarejoView
      vendas={(vendas ?? []) as unknown as VendaRelatorio[]}
      pagamentos={(pagamentos ?? []) as unknown as (PagamentoRelatorio & { vendas: { criada_em: string; status: string } })[]}
      perfis={(perfis ?? []) as Perfil[]}
      itensAtacado={itensAtacado}
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
