"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(_prevState: string | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return "Preencha e-mail e senha.";
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Log real da causa fica só no servidor — a mensagem pro usuário é
    // sempre genérica (não revela se o e-mail existe, se a conta não foi
    // confirmada, ou se houve erro de configuração/rede).
    console.error("Falha no login:", error.code ?? error.name, error.message);
    return "E-mail ou senha incorretos.";
  }

  redirect("/");
}
