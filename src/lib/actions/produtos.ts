"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

function numeroOuZero(valor: FormDataEntryValue | null): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
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
