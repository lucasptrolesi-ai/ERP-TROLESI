"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

export async function salvarFornecedor(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const nome = normalizarCampo(formData.get("nome"));
  if (!nome) return { erro: "Nome é obrigatório." };

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    nome,
    cnpj: normalizarCampo(formData.get("cnpj")),
    telefone: normalizarCampo(formData.get("telefone")),
    cidade: normalizarCampo(formData.get("cidade")),
    uf: normalizarCampo(formData.get("uf"))?.toUpperCase().slice(0, 2) ?? null,
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("fornecedores").update(dados).eq("id", id)
    : await supabase.from("fornecedores").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error) };

  revalidatePath("/cadastros");
  return undefined;
}

export async function alternarAtivoFornecedor(id: string, ativo: boolean) {
  const supabase = await createClient();
  await supabase.from("fornecedores").update({ ativo }).eq("id", id);
  revalidatePath("/cadastros");
}

export async function excluirFornecedor(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("fornecedores").delete().eq("id", id);
  if (error) return { erro: mensagemErroExcluir(error) };

  revalidatePath("/cadastros");
  return {};
}
