import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PerfilAtual = {
  id: string;
  email: string;
  nome: string;
  papel: string;
};

/**
 * Busca usuário + perfil uma única vez por request (cache() do React dedupe
 * chamadas repetidas dentro do mesmo render tree) e redireciona pra /login
 * se não houver sessão — única fonte de verdade pro layout e todas as
 * páginas abaixo dele, em vez de cada uma checar auth do seu jeito.
 */
export const getPerfilAtual = cache(async (): Promise<PerfilAtual> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, papel")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // O trigger handle_novo_usuario garante uma linha em profiles pra todo
    // auth.users — se não existe, é uma falha real (RLS mal configurada,
    // trigger não rodou), não um estado esperado. Loga em vez de mascarar.
    console.error(`Usuário ${user.id} autenticado sem linha em profiles.`);
  }

  return {
    id: user.id,
    email: user.email ?? "",
    nome: profile?.nome || user.email || "Usuário",
    papel: profile?.papel ?? "sem_papel",
  };
});
