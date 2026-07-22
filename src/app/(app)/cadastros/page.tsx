import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { CadastrosView } from "./cadastros-view";

export default async function CadastrosPage() {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();

  const [{ data: clientes }, { data: fornecedores }, { data: funcionarios }] = await Promise.all([
    supabase.from("clientes").select("*").order("nome"),
    supabase.from("fornecedores").select("*").order("nome"),
    supabase.from("profiles").select("id, nome, email, papel, ativo").order("nome"),
  ]);

  return (
    <CadastrosView
      papelAtual={perfil.papel}
      meuId={perfil.id}
      clientes={clientes ?? []}
      fornecedores={fornecedores ?? []}
      funcionarios={funcionarios ?? []}
    />
  );
}
