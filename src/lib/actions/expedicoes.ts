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

  let custo = 0;
  if (!freteGratis) {
    const custoTexto = String(formData.get("custo") ?? "").trim();
    if (custoTexto !== "") {
      const numerico = Number(custoTexto.replace(",", "."));
      // Um valor digitado errado (ex: com o "R$" na frente, viraria NaN) não
      // pode virar frete grátis silencioso via `|| 0` — campo em branco é 0
      // de propósito, qualquer outra coisa que não parseie é erro explícito.
      if (Number.isNaN(numerico) || numerico < 0) {
        return { erro: "Custo do frete inválido. Digite só números (ex: 45,00)." };
      }
      custo = numerico;
    }
  }

  const supabase = await createClient();
  // Concede frete grátis exige a permissão `conceder_frete_gratis` e motivo
  // obrigatório — checado dentro da function, não confiar em nada aqui.
  const { error } = await supabase.rpc("criar_expedicao", {
    p_pedido_id: pedidoId,
    p_endereco_entrega: String(formData.get("endereco_entrega") ?? "") || null,
    p_destinatario: String(formData.get("destinatario") ?? "") || null,
    p_transportadora: String(formData.get("transportadora") ?? "") || null,
    p_modalidade: String(formData.get("modalidade") ?? "") || null,
    p_custo: custo,
    p_frete_gratis: freteGratis,
    p_motivo_frete_gratis: freteGratis ? String(formData.get("motivo_frete_gratis") ?? "") || null : null,
  });

  if (error) return { erro: error.message };

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
