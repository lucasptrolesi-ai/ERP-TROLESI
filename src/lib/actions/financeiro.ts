"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

// O alerta de vencimentos mora no layout raiz (fora de /financeiro), não só
// na página — revalidar só "/financeiro" deixa o sininho com contagem
// desatualizada depois de uma baixa. `revalidatePath("/", "layout")`
// invalida o layout e tudo abaixo dele.
function revalidarFinanceiro() {
  revalidatePath("/financeiro");
  revalidatePath("/", "layout");
}

export async function salvarContaPagar(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const descricao = normalizarCampo(formData.get("descricao"));
  if (!descricao) return { erro: "Descrição é obrigatória." };

  const valor = Number(String(formData.get("valor") ?? "").replace(",", "."));
  if (!(valor > 0)) return { erro: "Valor precisa ser maior que zero." };

  const vencimento = normalizarCampo(formData.get("vencimento"));
  if (!vencimento) return { erro: "Vencimento é obrigatório." };

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    descricao,
    valor,
    vencimento,
    fornecedor_id: normalizarCampo(formData.get("fornecedor_id")),
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("contas_pagar").update(dados).eq("id", id)
    : await supabase.from("contas_pagar").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error) };

  revalidarFinanceiro();
  return undefined;
}

export async function excluirContaPagar(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("contas_pagar").delete().eq("id", id);
  if (error) return { erro: mensagemErroExcluir(error, "movimentos") };

  revalidarFinanceiro();
  return {};
}

async function marcarConta(
  tabela: "contas_receber" | "contas_pagar",
  id: string,
  pago: boolean,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from(tabela)
    .update({ situacao: pago ? "pago" : "em_dia", pago_em: pago ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { erro: "Não foi possível atualizar. Tente novamente." };

  revalidarFinanceiro();
  return {};
}

export async function marcarContaReceberPaga(id: string, pago: boolean): Promise<{ erro?: string }> {
  return marcarConta("contas_receber", id, pago);
}

export async function marcarContaPagarPaga(id: string, pago: boolean): Promise<{ erro?: string }> {
  return marcarConta("contas_pagar", id, pago);
}
