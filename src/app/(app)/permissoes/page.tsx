import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { PermissoesView } from "./permissoes-view";
import type { PermissaoUsuario } from "@/lib/types";

export type PerfilComPapel = { id: string; nome: string; papel: string; ativo: boolean };

export default async function PermissoesPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Concessão de permissões é restrita a administradores.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: perfis }, { data: permissoes }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, nome, papel, ativo")
      .neq("papel", "admin")
      .eq("ativo", true)
      .order("nome"),
    supabase.from("permissoes_usuario").select("*"),
  ]);

  return (
    <PermissoesView
      perfis={(perfis ?? []) as PerfilComPapel[]}
      permissoes={(permissoes ?? []) as PermissaoUsuario[]}
    />
  );
}
