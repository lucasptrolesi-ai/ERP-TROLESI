import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { EstoqueView } from "./estoque-view";

export default async function EstoquePage() {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();
  const { data: produtos } = await supabase.from("produtos").select("*").order("nome");

  return <EstoqueView papelAtual={perfil.papel} produtos={produtos ?? []} />;
}
