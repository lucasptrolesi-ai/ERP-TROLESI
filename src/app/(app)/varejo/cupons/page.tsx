import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { CuponsVarejoView } from "./cupons-varejo-view";
import type { CupomVarejo } from "@/lib/varejo/tipos";

export default async function CuponsVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin" && perfil.papel !== "vendedor") {
    return <Aviso texto="Você não tem permissão para gerenciar cupons." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO" && !contexto?.dono) {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para gerenciar cupons." />;
  }

  const supabase = await createClient();
  const { data: cupons } = await supabase.from("cupons_varejo").select("*").order("criado_em", { ascending: false });

  return <CuponsVarejoView cupons={(cupons ?? []) as CupomVarejo[]} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
