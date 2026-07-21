"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPerfilAtual } from "@/lib/supabase/auth";

type PapelUsuario = "admin" | "vendedor" | "financeiro" | "estoque";

function gerarSenhaTemporaria(): string {
  // Base64url de 12 bytes aleatórios — só letras/dígitos/-/_, sem símbolo
  // que compliquem copiar/colar, mas com entropia suficiente pra uma senha
  // temporária de primeiro acesso.
  return randomBytes(12).toString("base64url");
}

export async function criarFuncionario(
  nome: string,
  email: string,
  papel: PapelUsuario,
): Promise<{ erro?: string; senhaTemporaria?: string }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem cadastrar funcionários." };
  }
  if (!nome.trim() || !email.trim()) {
    return { erro: "Nome e e-mail são obrigatórios." };
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password: senhaTemporaria,
    email_confirm: true,
    user_metadata: { nome: nome.trim() },
  });

  if (error || !data.user) {
    // auth.admin.createUser já valida formato de e-mail e duplicidade —
    // repassa a mensagem em vez de reimplementar essa validação aqui.
    return { erro: error?.message ?? "Não foi possível criar o funcionário." };
  }

  const supabase = await createClient();
  const { error: erroRegistro } = await supabase.rpc("registrar_funcionario_criado", {
    p_profile_id: data.user.id,
    p_papel: papel,
    p_email: email.trim(),
  });
  if (erroRegistro) {
    // O login já foi criado no Auth — não desfaz (evita deixar o admin sem
    // saber se a conta existe ou não); reporta o erro pra ele revisar o
    // papel manualmente se precisar.
    return { erro: `Funcionário criado, mas houve um erro ao definir o papel: ${erroRegistro.message}`, senhaTemporaria };
  }

  revalidatePath("/permissoes");
  return { senhaTemporaria };
}
