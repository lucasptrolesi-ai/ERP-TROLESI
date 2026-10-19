"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, normalizarCampo } from "./erros";

// Cliente de verdade no PDV Varejo (2026-10-19): reaproveita a MESMA tabela `clientes` do Atacado
// (global, sem operacao_id) em vez de uma tabela paralela -- um cliente pode comprar nas duas
// operações. Essa tela só expõe/grava os campos que importam pra venda de balcão (nome/telefone/
// cpf_cnpj); os campos de crediário legado e Receita Federal usados pelo Atacado ficam de fora,
// intocados. RLS (`20260713000002`/`20260812000004`) já restringe insert/update a vendedor+admin --
// não precisa reforçar aqui.

export type ClienteResumoVarejo = { id: string; nome: string; telefone: string | null; cpf_cnpj: string | null };

// PostgREST usa vírgula pra separar condições do `.or()` e parênteses pra agrupar -- um termo digitado
// com vírgula (ex: "SILVA & CIA, LTDA") quebraria o parsing do filtro ou, pior, seria lido como
// condições extras. Escapa os caracteres reservados (`\`, `,`, `(`, `)`) com backslash antes de montar
// a string do filtro, como a sintaxe do PostgREST exige.
function escaparTermoOr(valor: string): string {
  return valor.replace(/[\\,()]/g, (c) => `\\${c}`);
}

/** Busca rápida pro autocomplete do PDV -- nome, telefone ou CPF/CNPJ, só clientes ativos. */
export async function buscarClientesVarejo(termo: string): Promise<ClienteResumoVarejo[]> {
  const termoLimpo = termo.trim();
  if (termoLimpo.length < 2) return [];
  const termoEscapado = escaparTermoOr(termoLimpo);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome, telefone, cpf_cnpj")
    .eq("ativo", true)
    .or(`nome.ilike.%${termoEscapado}%,telefone.ilike.%${termoEscapado}%,cpf_cnpj.ilike.%${termoEscapado}%`)
    .order("nome")
    .limit(10);
  if (error || !data) return [];
  return data as ClienteResumoVarejo[];
}

/** Cadastro rápido direto do PDV -- só o essencial pra venda de balcão; ficha completa (endereço,
 * nascimento etc.) continua em /cadastros pra quem quiser complementar depois. */
export async function criarClienteRapidoVarejo(formData: FormData): Promise<{ erro?: string; cliente?: ClienteResumoVarejo }> {
  const nome = normalizarCampo(formData.get("nome"), { caixaAlta: true });
  if (!nome) return { erro: "Informe o nome do cliente." };
  const dados = {
    nome,
    telefone: normalizarCampo(formData.get("telefone")),
    cpf_cnpj: normalizarCampo(formData.get("cpf_cnpj")),
  };
  const supabase = await createClient();
  const { data, error } = await supabase.from("clientes").insert(dados).select("id, nome, telefone, cpf_cnpj").single();
  if (error) return { erro: mensagemErroSalvar(error) };
  revalidatePath("/cadastros");
  return { cliente: data as ClienteResumoVarejo };
}
