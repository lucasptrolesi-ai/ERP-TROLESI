import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { CatalogoVarejoView } from "./catalogo-varejo-view";

type LinhaCatalogo = {
  variacao_id: string;
  produto_id: string;
  produto_nome: string;
  categoria: string | null;
  sku: string;
  preco_venda: number;
  preco_minimo: number | null;
  ativo: boolean;
};

export default async function CatalogoVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin" && perfil.papel !== "estoque") {
    return <Aviso texto="Só administradores e o time de estoque acessam o catálogo do varejo." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para acessar o catálogo." />;
  }

  const supabase = await createClient();
  const [{ data: variacoes }, { data: depositos }] = await Promise.all([
    supabase
      .from("catalogo_variacoes")
      .select("id, produto_id, sku, preco_venda, preco_minimo, ativo, catalogo_produtos(nome, categoria)")
      .order("criado_em", { ascending: false }),
    supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
  ]);

  const linhas: LinhaCatalogo[] = (variacoes ?? []).map((v) => {
    const produto = Array.isArray(v.catalogo_produtos) ? v.catalogo_produtos[0] : v.catalogo_produtos;
    return {
      variacao_id: v.id,
      produto_id: v.produto_id,
      produto_nome: produto?.nome ?? "",
      categoria: produto?.categoria ?? null,
      sku: v.sku,
      preco_venda: v.preco_venda,
      preco_minimo: v.preco_minimo,
      ativo: v.ativo,
    };
  });

  return <CatalogoVarejoView linhas={linhas} depositos={(depositos ?? []) as { id: string; nome: string }[]} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
      {texto}
    </div>
  );
}
