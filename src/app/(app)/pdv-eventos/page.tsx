import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { comoLista } from "@/lib/supabase-embed";
import { PdvEventosView } from "./pdv-eventos-view";
import type { VendaEvento } from "@/lib/types";

export default async function PdvEventosPage() {
  const perfil = await getPerfilAtual();

  // Mesmos papéis do PDV real (admin/vendedor) — é quem opera venda no
  // balcão/estande. Financeiro/estoque não têm motivo pra mexer aqui, e a
  // RLS de produtos_evento/criar_venda_evento já restringe a escrita do
  // mesmo jeito; a checagem explícita evita a tela "zerada" sem explicação.
  if (!podeEditarPedidos(perfil.papel)) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar o PDV Eventos. Fale com um admin se precisar de acesso.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: produtosEvento }, { data: vendasEvento }] = await Promise.all([
    supabase.from("produtos_evento").select("*").order("criado_em", { ascending: false }),
    supabase
      .from("vendas_evento")
      .select("*, vendas_evento_itens(nome, quantidade, preco_unitario)")
      .eq("status", "faturado")
      .order("criado_em", { ascending: false }),
  ]);

  return (
    <PdvEventosView
      produtosEvento={produtosEvento ?? []}
      vendasEvento={comoLista<VendaEvento>(vendasEvento)}
    />
  );
}
