import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { PdvVarejoView } from "./pdv-varejo-view";
import type { ItemCatalogo, SessaoCaixa, Supervisor } from "@/lib/varejo/tipos";

// Venda do varejo: custo e margem NUNCA aparecem aqui, em nenhuma hipótese — regra do módulo de
// varejo, independente do papel. As views do banco (pdv_catalogo, minha_sessao_caixa,
// pdv_supervisores) já não têm coluna de custo; nada aqui lê movimentos_estoque/venda_itens.
export default async function PdvVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin" && perfil.papel !== "vendedor") {
    return <AvisoAcesso texto="Você não tem permissão para acessar o PDV do varejo." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <AvisoAcesso texto="Troque para a operação Varejo (seletor no topo) para acessar o PDV." />;
  }

  const supabase = await createClient();
  const [{ data: sessao }, { data: catalogo }, { data: supervisores }] = await Promise.all([
    supabase.from("minha_sessao_caixa").select("*").maybeSingle(),
    supabase.from("pdv_catalogo").select("*").order("nome"),
    supabase.from("pdv_supervisores").select("*").order("nome"),
  ]);

  return (
    <PdvVarejoView
      sessao={sessao as SessaoCaixa | null}
      catalogo={(catalogo ?? []) as ItemCatalogo[]}
      supervisores={(supervisores ?? []) as Supervisor[]}
    />
  );
}

function AvisoAcesso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
