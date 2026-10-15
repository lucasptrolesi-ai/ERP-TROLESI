import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { createClient } from "@/lib/supabase/server";
import { dataLocalDoTimestamptz, hojeIso } from "@/lib/datas";
import { formatarAtributos } from "@/lib/varejo/atributos";
import { listarModelosEtiqueta } from "@/lib/actions/etiquetas";
import { EtiquetasTabs } from "../etiquetas-tabs";
import { LoteEtiquetasView, type LinhaLote } from "./lote-view";

export default async function LoteEtiquetasPage({ searchParams }: { searchParams: Promise<{ modelo?: string }> }) {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();
  const { modelo: modeloIdParam } = await searchParams;

  if (perfil.papel !== "admin" && perfil.papel !== "estoque") {
    return <Aviso texto="Só administradores e o time de estoque acessam Etiquetas." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO") {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para acessar Etiquetas." />;
  }

  const supabase = await createClient();
  const [{ data: variacoes }, { data: movimentos }, modelos] = await Promise.all([
    supabase
      .from("catalogo_variacoes")
      .select("id, sku, preco_venda, atributos, catalogo_produtos(nome, categoria)")
      .eq("ativo", true)
      .order("criado_em", { ascending: false }),
    supabase.from("estoque_movimentos").select("variacao_id, quantidade, criado_em"),
    listarModelosEtiqueta(),
  ]);

  // Saldo (soma de todos os movimentos) e quanto entrou hoje (só tipo entrada, dia de Brasília) —
  // mesma função já usada no resto do app pra não reintroduzir o bug de fuso perto da meia-noite.
  const saldoPorVariacao = new Map<string, number>();
  const entradaHojePorVariacao = new Map<string, number>();
  const hoje = hojeIso();
  for (const m of movimentos ?? []) {
    saldoPorVariacao.set(m.variacao_id, (saldoPorVariacao.get(m.variacao_id) ?? 0) + m.quantidade);
    if (m.quantidade > 0 && dataLocalDoTimestamptz(m.criado_em) === hoje) {
      entradaHojePorVariacao.set(m.variacao_id, (entradaHojePorVariacao.get(m.variacao_id) ?? 0) + m.quantidade);
    }
  }

  const linhas: LinhaLote[] = (variacoes ?? []).map((v) => {
    const produto = Array.isArray(v.catalogo_produtos) ? v.catalogo_produtos[0] : v.catalogo_produtos;
    const estoque = saldoPorVariacao.get(v.id) ?? 0;
    const entradaHoje = entradaHojePorVariacao.get(v.id) ?? 0;
    // "O padrão é a quantidade que entrou hoje; senão, o estoque" (plano aprovado) — nunca negativo.
    const quantidadeSugerida = entradaHoje > 0 ? entradaHoje : Math.max(estoque, 0);
    return {
      variacaoId: v.id,
      codigo: v.sku,
      nome: produto?.nome ?? "",
      atributos: formatarAtributos(v.atributos),
      preco: v.preco_venda,
      estoque,
      quantidadeSugerida,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <EtiquetasTabs ativo="lote" />
      <LoteEtiquetasView linhas={linhas} modelos={modelos} modeloIdInicial={modeloIdParam} />
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">{texto}</div>;
}
