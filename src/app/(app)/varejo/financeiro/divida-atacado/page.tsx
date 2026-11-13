import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { mapearItensAtacado, type DividaBruta } from "@/lib/varejo/divida-atacado";
import { DividaAtacadoNotinhaView } from "./divida-atacado-notinha-view";

export default async function DividaAtacadoNotinhaPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="Essa notinha é restrita a administradores." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO" && !contexto?.dono) {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para gerar essa notinha." />;
  }

  const supabase = await createClient();
  // Mesmo escopo do KPI "Em aberto com o Atacado": só origem venda (venda_item_id), nunca
  // paga ainda, sem limite de data -- é o saldo devedor corrente, não um recorte de período
  // (ver src/app/(app)/varejo/financeiro/page.tsx e DECISIONS.md, 2026-11-04).
  const { data: dividas } = await supabase
    .from("varejo_dividas_atacado")
    .select("id, codigo_atacado, quantidade, custo_total, venda_itens(venda_id, descricao_manual), catalogo_variacoes(catalogo_produtos(nome))")
    .eq("status", "em_aberto")
    .not("venda_item_id", "is", null)
    .order("criado_em", { ascending: true });

  const itens = mapearItensAtacado((dividas ?? []) as unknown as DividaBruta[]);

  return <DividaAtacadoNotinhaView itens={itens} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
