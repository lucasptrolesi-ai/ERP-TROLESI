import { createClient } from "@/lib/supabase/server";
import { hojeIso } from "@/lib/datas";
import { CotacaoDoDia } from "@/components/cotacao-do-dia";
import type { CotacaoDiaria } from "@/lib/types";

// Antes vivia dentro de Produtos & Estoque (2026-07-21) — movido pra item
// próprio de menu a pedido do usuário (2026-09-01): a cotação vale tanto
// pro Estoque real quanto pro PDV Eventos (ouro em peça de evento, ver
// produtos_evento.usa_cotacao_diaria), então não fazia sentido morar
// dentro de só um dos dois módulos.
export default async function CotacaoPage() {
  const supabase = await createClient();
  const [{ data: cotacoesHoje }, { data: podeInformarCotacao }] = await Promise.all([
    supabase.from("cotacoes_diarias").select("*").eq("data", hojeIso()),
    supabase.rpc("tem_permissao", { p_permissao: "informar_cotacao" }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <CotacaoDoDia
        cotacoesHoje={(cotacoesHoje ?? []) as CotacaoDiaria[]}
        podeInformar={podeInformarCotacao === true}
      />
    </div>
  );
}
