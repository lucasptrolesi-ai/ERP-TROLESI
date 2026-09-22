import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { CaixaVarejoView } from "./caixa-varejo-view";
import type { SessaoCaixa } from "@/lib/varejo/tipos";

export default async function CaixaVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin" && perfil.papel !== "vendedor") {
    return <Aviso texto="Você não tem permissão para acessar o caixa do varejo." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para acessar o caixa." />;
  }

  const supabase = await createClient();
  const [{ data: sessao }, { data: caixas }] = await Promise.all([
    supabase.from("minha_sessao_caixa").select("*").maybeSingle(),
    supabase.from("caixas").select("id, nome").eq("ativo", true).order("nome"),
  ]);

  return (
    <CaixaVarejoView
      sessao={sessao as SessaoCaixa | null}
      caixas={(caixas ?? []) as { id: string; nome: string }[]}
    />
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
