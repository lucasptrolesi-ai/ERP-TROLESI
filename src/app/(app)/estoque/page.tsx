import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { EstoqueView } from "./estoque-view";
import type { ProdutoEventoVinculado } from "@/lib/types";

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>;
}) {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();
  const [{ data: produtos }, { data: produtosEventoVinculados }, { editar }] = await Promise.all([
    supabase.from("produtos").select("*").order("nome"),
    // Peças do PDV Eventos que vieram de uma importação (produto_origem_id
    // preenchido) e ainda têm quantidade no evento — matéria-prima do
    // botão "Devolução".
    supabase
      .from("produtos_evento")
      .select("id, nome, codigo_interno, foto_url, quantidade_estoque, produto_origem_id")
      .not("produto_origem_id", "is", null)
      .gt("quantidade_estoque", 0),
    searchParams,
  ]);

  return (
    <EstoqueView
      papelAtual={perfil.papel}
      produtos={produtos ?? []}
      editarId={editar}
      produtosEventoVinculados={(produtosEventoVinculados ?? []) as ProdutoEventoVinculado[]}
    />
  );
}
