"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ResultadoForm = { erro?: string } | undefined;

const PROXIMO_STATUS: Record<string, string | null> = {
  aguardando_separacao: "em_separacao",
  em_separacao: "pronto_para_envio",
  pronto_para_envio: "postado",
  postado: "em_transporte",
  em_transporte: "entregue",
  entregue: null,
  devolvido: null,
  problema_transporte: null,
};

export async function criarExpedicao(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const pedidoId = String(formData.get("pedido_id") ?? "");
  if (!pedidoId) return { erro: "Selecione um pedido." };

  const freteGratis = formData.get("frete_gratis") === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("expedicoes").insert({
    pedido_id: pedidoId,
    endereco_entrega: String(formData.get("endereco_entrega") ?? "") || null,
    destinatario: String(formData.get("destinatario") ?? "") || null,
    transportadora: String(formData.get("transportadora") ?? "") || null,
    modalidade: String(formData.get("modalidade") ?? "") || null,
    custo: freteGratis ? 0 : Number(String(formData.get("custo") ?? "0").replace(",", ".")) || 0,
    frete_gratis: freteGratis,
    motivo_frete_gratis: freteGratis ? String(formData.get("motivo_frete_gratis") ?? "") || null : null,
  });

  if (error) return { erro: "Não foi possível criar a expedição. Tente novamente." };

  revalidatePath("/frete");
  return undefined;
}

export async function avancarStatusExpedicao(id: string, statusAtual: string): Promise<{ erro?: string }> {
  const proximo = PROXIMO_STATUS[statusAtual];
  if (!proximo) return { erro: "Este status já é final." };

  const supabase = await createClient();
  const { error } = await supabase.from("expedicoes").update({ status: proximo }).eq("id", id);
  if (error) return { erro: error.message };

  revalidatePath("/frete");
  return {};
}
