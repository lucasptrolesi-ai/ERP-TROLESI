import { getPerfilAtual } from "@/lib/supabase/auth";
import { GmaxView } from "./gmax-view";

export default async function GmaxPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Importação de vendas do GMax é restrita a administradores.
      </div>
    );
  }

  return <GmaxView />;
}
