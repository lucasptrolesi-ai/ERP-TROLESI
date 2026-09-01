import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { comoLista } from "@/lib/supabase-embed";
import { hojeIso } from "@/lib/datas";
import { PdvEventosView } from "./pdv-eventos-view";
import type { ProdutoParaImportar, VendaEvento } from "@/lib/types";

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
  const [{ data: produtosEvento }, { data: vendasEvento }, { data: produtosReais }, { data: cotacaoOuro }] =
    await Promise.all([
      supabase.from("produtos_evento").select("*").order("criado_em", { ascending: false }),
      supabase
        .from("vendas_evento")
        .select("*, vendas_evento_itens(nome, quantidade, preco_unitario)")
        .eq("status", "faturado")
        .order("criado_em", { ascending: false }),
      // Recorte leve pro modal "Importar do Estoque" — não precisa das ~40
      // colunas comerciais de produtos, só o suficiente pra buscar e conferir
      // estoque disponível.
      supabase
        .from("produtos")
        .select("id, nome, codigo_interno, foto_url, preco, quantidade_estoque, ativo")
        .order("nome"),
      // Mesma cotação diária da tela "Cotação" (material 'Ouro') — usada
      // pela entrada rápida de peça de ouro no estoque do evento.
      supabase.from("cotacoes_diarias").select("valor").eq("material", "Ouro").eq("data", hojeIso()).maybeSingle(),
    ]);

  return (
    <PdvEventosView
      produtosEvento={produtosEvento ?? []}
      vendasEvento={comoLista<VendaEvento>(vendasEvento)}
      produtosReais={(produtosReais ?? []) as ProdutoParaImportar[]}
      cotacaoOuroHoje={cotacaoOuro?.valor ?? null}
    />
  );
}
