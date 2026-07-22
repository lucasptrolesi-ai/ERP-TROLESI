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
  revalidatePath("/cadastros");
  return { senhaTemporaria };
}

export async function atualizarFuncionario(
  id: string,
  nome: string,
  papel: PapelUsuario,
): Promise<{ erro?: string; senhaTemporaria?: never }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem editar funcionários." };
  }
  if (!nome.trim()) {
    return { erro: "Nome é obrigatório." };
  }
  if (perfil.id === id && papel !== "admin") {
    return { erro: "Você não pode remover o próprio papel de admin." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ nome: nome.trim(), papel }).eq("id", id);
  if (error) return { erro: "Não foi possível salvar as alterações." };

  await supabase.rpc("registrar_acao_funcionario", {
    p_profile_id: id,
    p_acao: "editar_funcionario",
    p_valor_anterior: null,
    p_valor_novo: { nome: nome.trim(), papel },
  });

  revalidatePath("/cadastros");
  return {};
}

export async function resetarSenhaFuncionario(
  id: string,
  senhaEscolhida?: string,
): Promise<{ erro?: string; senhaTemporaria?: string }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem resetar senha." };
  }
  if (senhaEscolhida && senhaEscolhida.length < 8) {
    return { erro: "A senha precisa ter pelo menos 8 caracteres." };
  }

  // Se o admin digitou uma senha específica, usa ela (ex: pra definir a
  // própria senha de escolha, em vez de receber uma gerada aleatória).
  // Sem isso, gera uma temporária pra repassar pra outro funcionário.
  const senhaFinal = senhaEscolhida || gerarSenhaTemporaria();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password: senhaFinal });
  if (error) return { erro: error.message };

  const supabase = await createClient();
  await supabase.rpc("registrar_acao_funcionario", {
    p_profile_id: id,
    p_acao: "resetar_senha_funcionario",
  });

  // Só devolve a senha pra exibir na tela quando foi gerada aleatoriamente —
  // a que o próprio admin digitou ele já sabe, não precisa reexibir.
  return senhaEscolhida ? {} : { senhaTemporaria: senhaFinal };
}

export async function alternarAtivoFuncionario(id: string, ativo: boolean): Promise<{ erro?: string }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem ativar/desativar funcionários." };
  }
  if (perfil.id === id) {
    return { erro: "Você não pode desativar a própria conta." };
  }

  const admin = createAdminClient();
  // Desativar bane o login de verdade (Supabase Auth) — só marcar
  // profiles.ativo=false não impediria a pessoa de continuar entrando,
  // já que nada mais no projeto checava essa coluna até agora.
  const { error: erroBan } = await admin.auth.admin.updateUserById(id, {
    ban_duration: ativo ? "none" : "876600h",
  });
  if (erroBan) return { erro: erroBan.message };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ ativo }).eq("id", id);
  if (error) return { erro: "Não foi possível atualizar o status." };

  await supabase.rpc("registrar_acao_funcionario", {
    p_profile_id: id,
    p_acao: ativo ? "reativar_funcionario" : "desativar_funcionario",
  });

  revalidatePath("/cadastros");
  return {};
}

export async function excluirFuncionario(id: string): Promise<{ erro?: string }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem excluir funcionários." };
  }
  if (perfil.id === id) {
    return { erro: "Você não pode excluir a própria conta." };
  }

  const supabase = await createClient();
  // Audita ANTES de excluir — depois de excluído não sobra profile_id
  // válido pra registrar_auditoria referenciar (a FK de audit_log.usuario_id
  // aponta pra profiles, mas registro_id é livre; ainda assim, registrar
  // antes evita qualquer corrida entre o registro e o cascade delete).
  await supabase.rpc("registrar_acao_funcionario", {
    p_profile_id: id,
    p_acao: "excluir_funcionario",
  });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    // Motivo mais comum: o funcionário já tem vendas, aprovações ou outros
    // registros vinculados (FK sem cascade, de propósito — histórico real
    // não pode sumir junto com o login). Desativar é o caminho seguro nesse
    // caso.
    return {
      erro: "Não foi possível excluir — esse funcionário provavelmente já tem vendas ou registros associados. Desative a conta em vez de excluir.",
    };
  }

  revalidatePath("/cadastros");
  return {};
}
