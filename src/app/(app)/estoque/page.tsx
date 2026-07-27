import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { hojeIso } from "@/lib/datas";
import { EstoqueView } from "./estoque-view";
import type { CotacaoDiaria } from "@/lib/types";

export default async function EstoquePage() {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();
  const [{ data: produtos }, { data: cotacoesHoje }, { data: podeInformarCotacao }] = await Promise.all([
    supabase.from("produtos").select("*").order("nome"),
    supabase.from("cotacoes_diarias").select("*").eq("data", hojeIso()),
    supabase.rpc("tem_permissao", { p_permissao: "informar_cotacao" }),
  ]);

  return (
    <EstoqueView
      papelAtual={perfil.papel}
      produtos={produtos ?? []}
      cotacoesHoje={(cotacoesHoje ?? []) as CotacaoDiaria[]}
      podeInformarCotacao={podeInformarCotacao === true}
    />
  );
}
