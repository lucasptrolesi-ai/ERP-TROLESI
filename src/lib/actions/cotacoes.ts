"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hojeIso } from "@/lib/datas";

export async function informarCotacao(material: string, valor: number): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("informar_cotacao", {
    p_material: material,
    p_valor: valor,
    p_data: hojeIso(),
  });
  if (error) return { erro: error.message };

  revalidatePath("/estoque");
  revalidatePath("/pedidos");
  return {};
}
