import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { TransferenciaView } from "./transferencia-view";

export default async function TransferenciaPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="Só administradores transferem estoque entre operações." />;
  }
  if (contexto?.operacao_codigo !== "ATACADO") {
    return <Aviso texto="Troque para a operação Atacado (seletor no topo) para transferir para o varejo." />;
  }

  const supabase = await createClient();
  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, nome, codigo_peca, quantidade_estoque")
    .eq("ativo", true)
    .gt("codigo_peca", 0)
    .order("nome");

  return <TransferenciaView produtosAtacado={produtos ?? []} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
