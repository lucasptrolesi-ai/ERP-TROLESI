import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { buscarCalculadoraPreco, type CalculadoraPreco } from "@/lib/varejo/financeiro-dados";
import { CatalogoVarejoView } from "./catalogo-varejo-view";
import type { LinhaCatalogo } from "@/lib/varejo/tipos";
import type { ModeloEtiqueta } from "@/lib/etiquetas/zpl";

export type { CalculadoraPreco };
export type ModeloComId = ModeloEtiqueta & { id: string };

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
  const [{ data: variacoes }, { data: depositos }, { data: modeloPadrao }] = await Promise.all([
    supabase
      .from("catalogo_variacoes")
      .select("id, produto_id, sku, atributos, preco_venda, preco_minimo, codigo_atacado, foto_url, localizacao, ativo, catalogo_produtos(nome, categoria)")
      .order("criado_em", { ascending: false }),
    supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
    // Módulo Etiquetas (2026-10-15) -- modal "Imprimir etiqueta" usa o modelo padrão do Varejo.
    // Acesso de admin e estoque (mesma dupla de papéis que já cadastra peça aqui), não só admin.
    supabase.from("etiqueta_modelos").select("*").eq("padrao_varejo", true).maybeSingle(),
  ]);

  const linhas: LinhaCatalogo[] = (variacoes ?? []).map((v) => {
    const produto = Array.isArray(v.catalogo_produtos) ? v.catalogo_produtos[0] : v.catalogo_produtos;
    return {
      variacao_id: v.id,
      produto_id: v.produto_id,
      produto_nome: produto?.nome ?? "",
      categoria: produto?.categoria ?? null,
      sku: v.sku,
      atributos: (v.atributos ?? {}) as Record<string, string>,
      preco_venda: v.preco_venda,
      preco_minimo: v.preco_minimo,
      codigo_atacado: v.codigo_atacado,
      foto_url: v.foto_url,
      localizacao: (v.localizacao ?? {}) as Record<string, string>,
      ativo: v.ativo,
    };
  });

  // Calculadora de preço (Controle Financeiro, Fase 5) -- só pro dono: custo/margem nunca vão pro
  // perfil estoque, mesmo esse tendo acesso ao resto desta tela.
  let calculadora: CalculadoraPreco | undefined;
  if (perfil.papel === "admin") {
    calculadora = (await buscarCalculadoraPreco(supabase)) ?? undefined;
  }

  return (
    <CatalogoVarejoView
      linhas={linhas}
      depositos={(depositos ?? []) as { id: string; nome: string }[]}
      calculadora={calculadora}
      modeloEtiqueta={(modeloPadrao as ModeloComId | null) ?? undefined}
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
