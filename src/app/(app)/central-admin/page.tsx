import { getPerfilAtual } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { CentralAdminView } from "./central-admin-view";

export type DecisaoPendente = { id: string; chave: string; descricao: string; criado_em: string };

export default async function CentralAdminPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Esta página é restrita a administradores.
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("listar_decisoes_pendentes");
  const decisoes = (data ?? []) as DecisaoPendente[];

  return <CentralAdminView nome={perfil.nome} decisoes={decisoes} />;
}
