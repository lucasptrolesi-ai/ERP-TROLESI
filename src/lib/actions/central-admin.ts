"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function resolverDecisaoPendente(chave: string, decisao: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolver_decisao_pendente", { p_chave: chave, p_decisao: decisao });
  if (error) return { erro: error.message };

  revalidatePath("/central-admin");
  return {};
}
