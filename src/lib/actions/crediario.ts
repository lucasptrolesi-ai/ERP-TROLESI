"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function converterEmCrediario(
  clienteId: string,
  limite: number,
  justificativa: string,
): Promise<{ erro?: string }> {
  if (!justificativa.trim()) return { erro: "Justificativa é obrigatória." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("converter_cliente_em_crediario", {
    p_cliente_id: clienteId,
    p_limite: limite,
    p_justificativa: justificativa,
  });
  if (error) return { erro: error.message };

  revalidatePath("/crediario");
  revalidatePath("/cadastros");
  return {};
}

export async function lancarCrediario(
  clienteId: string,
  valor: number,
  vencimento: string,
  pedidoId?: string,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lancar_crediario", {
    p_cliente_id: clienteId,
    p_pedido_id: pedidoId ?? null,
    p_valor: valor,
    p_vencimento: vencimento,
  });
  if (error) return { erro: error.message };

  revalidatePath("/crediario");
  return {};
}

export async function receberCrediario(id: string, reciboNumero?: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("receber_crediario", { p_id: id, p_recibo_numero: reciboNumero ?? null });
  if (error) return { erro: error.message };

  revalidatePath("/crediario");
  return {};
}
