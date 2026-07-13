"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

export async function salvarCliente(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const nome = normalizarCampo(formData.get("nome"));
  if (!nome) return { erro: "Nome é obrigatório." };

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    nome,
    cpf_cnpj: normalizarCampo(formData.get("cpf_cnpj")),
    telefone: normalizarCampo(formData.get("telefone")),
    email: normalizarCampo(formData.get("email")),
    data_nascimento: normalizarCampo(formData.get("data_nascimento")),
    cidade: normalizarCampo(formData.get("cidade")),
    uf: normalizarCampo(formData.get("uf"))?.toUpperCase().slice(0, 2) ?? null,
    bairro: normalizarCampo(formData.get("bairro")),
    cep: normalizarCampo(formData.get("cep")),
    endereco: normalizarCampo(formData.get("endereco")),
    razao_social: normalizarCampo(formData.get("razao_social")),
    nome_fantasia: normalizarCampo(formData.get("nome_fantasia")),
    situacao_cadastral: normalizarCampo(formData.get("situacao_cadastral")),
    data_abertura: normalizarCampo(formData.get("data_abertura")),
    natureza_juridica: normalizarCampo(formData.get("natureza_juridica")),
    porte: normalizarCampo(formData.get("porte")),
    atividade_principal: normalizarCampo(formData.get("atividade_principal")),
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("clientes").update(dados).eq("id", id)
    : await supabase.from("clientes").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error) };

  revalidatePath("/cadastros");
  revalidatePath("/pedidos");
  return undefined;
}

export async function alternarAtivoCliente(id: string, ativo: boolean) {
  const supabase = await createClient();
  await supabase.from("clientes").update({ ativo }).eq("id", id);
  revalidatePath("/cadastros");
  revalidatePath("/pedidos");
}

export async function excluirCliente(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) return { erro: mensagemErroExcluir(error) };

  revalidatePath("/cadastros");
  revalidatePath("/pedidos");
  return {};
}
