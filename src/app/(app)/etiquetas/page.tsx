import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { listarModelosEtiqueta } from "@/lib/actions/etiquetas";
import { EtiquetasTabs } from "./etiquetas-tabs";
import { ModelosEtiquetaView } from "./modelos-view";

export default async function ModelosEtiquetaPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin" && perfil.papel !== "estoque") {
    return <Aviso texto="Só administradores e o time de estoque acessam Etiquetas." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para acessar Etiquetas." />;
  }

  const modelos = await listarModelosEtiqueta();

  return (
    <div className="flex flex-col gap-4">
      <EtiquetasTabs ativo="modelos" />
      <ModelosEtiquetaView modelos={modelos} />
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">{texto}</div>;
}
