"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

function numeroOuZero(valor: FormDataEntryValue | null): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function numeroOuNulo(valor: FormDataEntryValue | null): number | null {
  if (valor === null || String(valor).trim() === "") return null;
  const n = Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function salvarProduto(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const nome = normalizarCampo(formData.get("nome"));
  const categoria = normalizarCampo(formData.get("categoria"));
  if (!nome) return { erro: "Nome é obrigatório." };
  if (!categoria) return { erro: "Categoria é obrigatória." };

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    nome,
    categoria,
    subcategoria: normalizarCampo(formData.get("subcategoria")),
    subsubcategoria: normalizarCampo(formData.get("subsubcategoria")),
    foto_url: normalizarCampo(formData.get("foto_url")),
    codigo_interno: normalizarCampo(formData.get("codigo_interno")),
    codigo_peca: Math.max(0, numeroOuZero(formData.get("codigo_peca"))),
    multiplicador: (() => {
      const valor = formData.get("multiplicador");
      // 0 é um multiplicador explícito válido (ex: brinde) — não pode cair
      // no fallback "|| 2.8" que trataria 0 como ausência de valor.
      // Máximo 99.99: é o limite da coluna numeric(4,2) no banco.
      if (valor === null || String(valor).trim() === "") return 2.8;
      return Math.min(99.99, Math.max(0, numeroOuZero(valor)));
    })(),
    quantidade_estoque: Math.max(0, Math.trunc(numeroOuZero(formData.get("quantidade_estoque")))),
    estoque_minimo: Math.max(0, Math.trunc(numeroOuZero(formData.get("estoque_minimo")))),
    ativo: formData.get("ativo") === "on",
    codigo_barras: normalizarCampo(formData.get("codigo_barras")),
    referencia: normalizarCampo(formData.get("referencia")),
    descricao: normalizarCampo(formData.get("descricao")),
    material: normalizarCampo(formData.get("material")),
    tipo_banho: normalizarCampo(formData.get("tipo_banho")),
    tem_pedra: formData.get("tem_pedra") === "on",
    tem_perola: formData.get("tem_perola") === "on",
    tem_resina: formData.get("tem_resina") === "on",
    eh_fita: formData.get("eh_fita") === "on",
    eh_fio: formData.get("eh_fio") === "on",
    eh_correntaria: formData.get("eh_correntaria") === "on",
    eh_fornitura: formData.get("eh_fornitura") === "on",
    eh_embalagem: formData.get("eh_embalagem") === "on",
    eh_relogio: formData.get("eh_relogio") === "on",
    colecao: normalizarCampo(formData.get("colecao")),
    ultima_colecao: formData.get("ultima_colecao") === "on",
    cor: normalizarCampo(formData.get("cor")),
    tamanho: normalizarCampo(formData.get("tamanho")),
    peso: numeroOuNulo(formData.get("peso")),
    genero: normalizarCampo(formData.get("genero")),
    garantia_tipo: normalizarCampo(formData.get("garantia_tipo")) ?? "sem_garantia",
    marca_gravada: formData.get("marca_gravada") === "on",
    custo_aquisicao: numeroOuNulo(formData.get("custo_aquisicao")),
    usa_cotacao_diaria: formData.get("usa_cotacao_diaria") === "on",
    preco_promocional: numeroOuNulo(formData.get("preco_promocional")),
    cest: normalizarCampo(formData.get("cest")),
    cfop_padrao: normalizarCampo(formData.get("cfop_padrao")),
    cst: normalizarCampo(formData.get("cst")),
    origem_mercadoria: normalizarCampo(formData.get("origem_mercadoria")) ?? "0",
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("produtos").update(dados).eq("id", id)
    : await supabase.from("produtos").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error, "código interno") };

  revalidatePath("/estoque");
  revalidatePath("/pedidos");
  return undefined;
}

export async function excluirProduto(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("produtos").delete().eq("id", id);
  if (error) return { erro: mensagemErroExcluir(error, "pedidos ou movimentos de estoque") };

  revalidatePath("/estoque");
  revalidatePath("/pedidos");
  return {};
}
