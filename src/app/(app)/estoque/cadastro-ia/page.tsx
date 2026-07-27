import { redirect } from "next/navigation";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarProdutos } from "@/lib/permissoes";
import { CadastroIaView } from "./cadastro-ia-view";

export default async function CadastroIaPage() {
  const perfil = await getPerfilAtual();
  if (!podeEditarProdutos(perfil.papel)) redirect("/estoque");

  return <CadastroIaView />;
}
