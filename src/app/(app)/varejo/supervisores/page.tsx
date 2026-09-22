import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { SupervisoresVarejoView } from "./supervisores-varejo-view";

type UsuarioDaOperacao = { profile_id: string; nome: string; ehSupervisor: boolean; ativo: boolean };

export default async function SupervisoresVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="Só administradores gerenciam supervisores." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para gerenciar supervisores." />;
  }

  const supabase = await createClient();
  const [{ data: vinculos }, { data: supervisores }] = await Promise.all([
    supabase.from("usuario_operacoes").select("profile_id, profiles(nome)").eq("operacao_id", contexto.operacao_id),
    supabase.from("admin_supervisores").select("profile_id, ativo"),
  ]);

  const supervisoresPorId = new Map((supervisores ?? []).map((s) => [s.profile_id, s.ativo]));
  const usuarios: UsuarioDaOperacao[] = (vinculos ?? []).map((v) => {
    const perfilVinculado = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
    return {
      profile_id: v.profile_id,
      nome: perfilVinculado?.nome ?? "",
      ehSupervisor: supervisoresPorId.has(v.profile_id),
      ativo: supervisoresPorId.get(v.profile_id) ?? false,
    };
  });

  return <SupervisoresVarejoView usuarios={usuarios} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
