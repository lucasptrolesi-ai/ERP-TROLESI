"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

// Além de Cadastros/Pedidos, /abatimentos, /crediario, /garantias e
// /relatorios também leem `clientes` (filtrado por ativo=true) — sem
// revalidar essas rotas, editar/desativar/excluir um cliente em Cadastros e
// navegar (client-side) pra qualquer uma delas mostrava o dado antigo.
function revalidarClientes() {
  revalidatePath("/cadastros");
  revalidatePath("/pedidos");
  revalidatePath("/abatimentos");
  revalidatePath("/crediario");
  revalidatePath("/garantias");
  revalidatePath("/relatorios");
}

export async function salvarCliente(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const nome = normalizarCampo(formData.get("nome"), { caixaAlta: true });
  if (!nome) return { erro: "Nome é obrigatório." };

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    nome,
    cpf_cnpj: normalizarCampo(formData.get("cpf_cnpj")),
    telefone: normalizarCampo(formData.get("telefone")),
    email: normalizarCampo(formData.get("email")),
    data_nascimento: normalizarCampo(formData.get("data_nascimento")),
    cidade: normalizarCampo(formData.get("cidade"), { caixaAlta: true }),
    uf: normalizarCampo(formData.get("uf"))?.toUpperCase().slice(0, 2) ?? null,
    bairro: normalizarCampo(formData.get("bairro"), { caixaAlta: true }),
    cep: normalizarCampo(formData.get("cep")),
    endereco: normalizarCampo(formData.get("endereco"), { caixaAlta: true }),
    razao_social: normalizarCampo(formData.get("razao_social"), { caixaAlta: true }),
    nome_fantasia: normalizarCampo(formData.get("nome_fantasia"), { caixaAlta: true }),
    situacao_cadastral: normalizarCampo(formData.get("situacao_cadastral"), { caixaAlta: true }),
    data_abertura: normalizarCampo(formData.get("data_abertura")),
    natureza_juridica: normalizarCampo(formData.get("natureza_juridica"), { caixaAlta: true }),
    porte: normalizarCampo(formData.get("porte"), { caixaAlta: true }),
    atividade_principal: normalizarCampo(formData.get("atividade_principal"), { caixaAlta: true }),
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("clientes").update(dados).eq("id", id)
    : await supabase.from("clientes").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error) };

  revalidarClientes();
  return undefined;
}

export async function alternarAtivoCliente(id: string, ativo: boolean): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("clientes").update({ ativo }).eq("id", id);
  if (error) return { erro: "Não foi possível atualizar. Tente novamente." };

  revalidarClientes();
  return {};
}

// Anotação manual pro vendedor lembrar quem da lista de "clientes inativos"
// (/relatorios) já foi contatado pra reativação — só isso, não dispara nada
// (decisão do usuário: "só marcar já entrei em contato"). Não é limpo
// automaticamente numa venda nova; se o cliente ficar inativo de novo depois,
// o marcador antigo continua até alguém marcar/desmarcar de novo.
export async function marcarClienteContatado(id: string, contatado: boolean): Promise<{ erro?: string }> {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clientes")
    .update({
      contatado_reativacao_em: contatado ? new Date().toISOString() : null,
      contatado_reativacao_por: contatado ? perfil.id : null,
    })
    .eq("id", id);
  if (error) return { erro: "Não foi possível atualizar. Tente novamente." };

  revalidatePath("/relatorios");
  return {};
}

// Auditoria LGPD (item 9, 2026-08-11 — ver DECISIONS.md): registra quando
// alguém abre a ficha completa de um cliente (CPF/endereço visíveis), não
// toda leitura da lista. Chama um wrapper SQL fino porque
// `registrar_auditoria` teve o EXECUTE revogado de `authenticated` de
// propósito (achado de segurança de 2026-07-21) — nunca pode ser chamada
// direto por RPC do cliente. Falha aqui nunca deve travar a tela: é só
// registro, não controle de acesso.
export async function registrarVisualizacaoFichaCliente(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("registrar_visualizacao_ficha_cliente", { p_cliente_id: id });
}

export async function excluirCliente(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) return { erro: mensagemErroExcluir(error) };

  revalidarClientes();
  return {};
}
