"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PermissaoEspecial } from "@/lib/types";

export async function concederPermissao(profileId: string, permissao: PermissaoEspecial): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("conceder_permissao", {
    p_profile_id: profileId,
    p_permissao: permissao,
  });
  if (error) return { erro: error.message };

  revalidatePath("/permissoes");
  return {};
}

export async function revogarPermissao(profileId: string, permissao: PermissaoEspecial): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revogar_permissao", {
    p_profile_id: profileId,
    p_permissao: permissao,
  });
  if (error) return { erro: error.message };

  revalidatePath("/permissoes");
  return {};
}
