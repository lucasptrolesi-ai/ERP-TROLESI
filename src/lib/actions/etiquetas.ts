"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatarAtributos } from "@/lib/varejo/atributos";
import { modeloParaZpl, type DadosPeca, type ElementoEtiqueta, type ModeloEtiqueta } from "@/lib/etiquetas/zpl";

// Módulo Etiquetas (Fase A, 2026-10-15): o app monta o ZPL inteiro aqui (motor genérico em
// src/lib/etiquetas/zpl.ts) e grava pronto na fila (solicitacoes_etiqueta.zpl) — o print-agent só
// envia, não monta mais nada (ver DECISIONS.md "Módulo Etiquetas").

type ErroPg = { code?: string; message: string };

function mensagem(erro: ErroPg): string {
  if (erro.code === "42501") return "Você não tem permissão para esta ação.";
  if (erro.code === "23514") return "Dados incoerentes pra montar a etiqueta.";
  return "Não foi possível concluir. Tente novamente.";
}

export type ModeloResumo = {
  id: string;
  nome: string;
  largura_mm: number;
  altura_mm: number;
  padrao_varejo: boolean;
  ativo: boolean;
  // Só pra pré-visualização em miniatura na tela de Modelos (PreviaModelo) — nada aqui monta ZPL.
  elementos: ElementoEtiqueta[];
};

export async function listarModelosEtiqueta(): Promise<ModeloResumo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("etiqueta_modelos")
    .select("id, nome, largura_mm, altura_mm, padrao_varejo, ativo, elementos")
    .eq("ativo", true)
    .order("padrao_varejo", { ascending: false })
    .order("nome");
  return (data ?? []) as ModeloResumo[];
}

export type ItemParaImprimir = {
  variacaoId: string;
  quantidade: number;
  // Edição manual da tela "Imprimir etiqueta", por id de elemento do modelo — vale só pra essa
  // impressão, não muda o modelo salvo (ver modeloParaZpl em zpl.ts).
  overrides?: Record<string, string>;
};

type VariacaoParaEtiqueta = {
  id: string;
  produto_id: string;
  sku: string;
  atributos: Record<string, string> | null;
  preco_venda: number;
  localizacao: Record<string, string> | null;
  catalogo_produtos: { nome: string; categoria: string | null } | { nome: string; categoria: string | null }[] | null;
};

/** Monta o ZPL de cada item (dados buscados agora, direto do banco — nunca confia no que o
 * navegador mandou) e grava a solicitação + o registro de histórico, em lote (um ou vários itens —
 * usado tanto pela tela "Imprimir etiqueta" do cadastro quanto pelo lote de `/etiquetas/lote`). */
export async function imprimirEtiquetas(itens: ItemParaImprimir[], modeloId?: string): Promise<{ erro?: string; ids?: string[] }> {
  if (itens.length === 0) return { erro: "Nenhuma peça selecionada." };
  const supabase = await createClient();

  const consultaModelo = modeloId
    ? supabase.from("etiqueta_modelos").select("*").eq("id", modeloId).maybeSingle()
    : supabase.from("etiqueta_modelos").select("*").eq("padrao_varejo", true).maybeSingle();
  const { data: modelo, error: erroModelo } = await consultaModelo;
  if (erroModelo || !modelo) return { erro: "Modelo de etiqueta não encontrado." };

  const variacaoIds = itens.map((i) => i.variacaoId);
  const { data: variacoes, error: erroVar } = await supabase
    .from("catalogo_variacoes")
    .select("id, produto_id, sku, atributos, preco_venda, localizacao, catalogo_produtos(nome, categoria)")
    .in("id", variacaoIds);
  if (erroVar || !variacoes) return { erro: "Não foi possível buscar as peças selecionadas." };
  const porId = new Map((variacoes as VariacaoParaEtiqueta[]).map((v) => [v.id, v]));

  const linhas: { produto_id: string; variacao_id: string; modelo_id: string; zpl: string; quantidade: number; dados: DadosPeca }[] = [];
  for (const item of itens) {
    const v = porId.get(item.variacaoId);
    if (!v) continue;
    const produto = Array.isArray(v.catalogo_produtos) ? v.catalogo_produtos[0] : v.catalogo_produtos;
    const nomeParaErro = produto?.nome ?? v.sku;
    if (!Number.isInteger(item.quantidade) || item.quantidade < 1) {
      return { erro: `Quantidade inválida pra "${nomeParaErro}".` };
    }
    if (v.sku.trim() === "") {
      return { erro: `"${nomeParaErro}" não tem código — não dá pra gerar o QR sem ele.` };
    }
    const dados: DadosPeca = {
      preco_venda: v.preco_venda,
      nome: produto?.nome ?? "",
      codigo: v.sku,
      atributos: formatarAtributos(v.atributos),
      categoria: produto?.categoria ?? "",
      localizacao: formatarAtributos(v.localizacao),
    };
    let zpl: string;
    try {
      zpl = modeloParaZpl(modelo as unknown as ModeloEtiqueta, dados, item.quantidade, item.overrides);
    } catch (erroZpl) {
      return { erro: `Erro ao montar a etiqueta de "${produto?.nome ?? v.sku}": ${(erroZpl as Error).message}` };
    }
    linhas.push({ produto_id: v.produto_id, variacao_id: v.id, modelo_id: modelo.id, zpl, quantidade: item.quantidade, dados });
  }
  if (linhas.length === 0) return { erro: "Nenhuma das peças selecionadas foi encontrada." };

  const { data: inseridas, error: erroInsercao } = await supabase
    .from("solicitacoes_etiqueta")
    .insert(linhas.map((l) => ({ produto_id: l.produto_id, variacao_id: l.variacao_id, modelo_id: l.modelo_id, zpl: l.zpl, quantidade: l.quantidade })))
    .select("id, variacao_id, quantidade");
  if (erroInsercao || !inseridas) return { erro: mensagem(erroInsercao ?? { message: "" }) };

  // As solicitações já estão gravadas (pendente) nesse ponto -- o print-agent vai pegar e imprimir
  // de qualquer jeito em ~2s. Gravar o histórico é uma preocupação separada e não deve fazer a tela
  // mostrar "falhou" (e o dono tentar de novo, duplicando a impressão) por causa de um erro só no
  // registro de auditoria -- mesmo espírito do comprovante em PDF do cupom (print-agent/README.md):
  // uma falha aqui não derruba a outra.
  const historico = inseridas.map((ins, i) => ({
    solicitacao_id: ins.id,
    modelo_id: modelo.id,
    variacao_id: ins.variacao_id,
    quantidade: ins.quantidade,
    dados: linhas[i].dados,
  }));
  const { error: erroHistorico } = await supabase.from("etiqueta_impressoes").insert(historico);
  if (erroHistorico) {
    console.error("Falha ao gravar etiqueta_impressoes (solicitações já criadas, vão imprimir normalmente):", erroHistorico.message);
  }

  revalidatePath("/etiquetas");
  return { ids: inseridas.map((i) => i.id as string) };
}

export type StatusEtiqueta = { status: "pendente" | "impresso" | "erro"; mensagem: string | null };

export async function buscarStatusEtiqueta(id: string): Promise<StatusEtiqueta> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("solicitacoes_etiqueta").select("status, erro").eq("id", id).single();
  if (error || !data) {
    return { status: "erro", mensagem: error?.message ?? "Solicitação de etiqueta não encontrada." };
  }
  return { status: data.status, mensagem: data.erro };
}

export type ResumoStatusLote = { pendentes: number; impressas: number; comErro: number; total: number };

/** Mesma ideia de buscarStatusEtiqueta, mas resumida pra um lote inteiro (tela /etiquetas/lote) —
 * uma consulta só em vez de uma por item, pra não sobrecarregar um lote de dezenas/centenas de
 * peças a cada ~1s de polling. */
export async function buscarStatusLote(ids: string[]): Promise<ResumoStatusLote> {
  if (ids.length === 0) return { pendentes: 0, impressas: 0, comErro: 0, total: 0 };
  const supabase = await createClient();
  const { data } = await supabase.from("solicitacoes_etiqueta").select("status").in("id", ids);
  const linhas = data ?? [];
  return {
    pendentes: linhas.filter((l) => l.status === "pendente").length,
    impressas: linhas.filter((l) => l.status === "impresso").length,
    comErro: linhas.filter((l) => l.status === "erro").length,
    total: ids.length,
  };
}
