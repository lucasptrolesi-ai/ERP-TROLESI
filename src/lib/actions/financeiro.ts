"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, mensagemErroExcluir, normalizarCampo } from "./erros";
import { comoTimestamptzBrasilia } from "@/lib/datas";
import type { FormaPagamento } from "@/lib/types";

type ResultadoForm = { erro?: string } | undefined;
type Tabela = "contas_receber" | "contas_pagar";

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

export type DadosBaixa = {
  pago_em: string;
  valor_pago: number;
  forma_pagamento: FormaPagamento;
  observacao: string | null;
};

async function darBaixa(tabela: Tabela, id: string, dados: DadosBaixa): Promise<{ erro?: string }> {
  if (!(dados.valor_pago > 0)) return { erro: "Valor pago precisa ser maior que zero." };
  if (!dados.pago_em) return { erro: "Informe a data do pagamento." };

  const supabase = await createClient();
  const { error } = await supabase
    .from(tabela)
    .update({
      situacao: "pago",
      pago_em: comoTimestamptzBrasilia(dados.pago_em),
      valor_pago: dados.valor_pago,
      forma_pagamento_baixa: dados.forma_pagamento,
      observacao_baixa: dados.observacao,
    })
    .eq("id", id);
  if (error) return { erro: "Não foi possível dar baixa. Tente novamente." };

  revalidarFinanceiro();
  return {};
}

async function desfazerBaixa(tabela: Tabela, id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from(tabela)
    .update({
      situacao: "em_dia",
      pago_em: null,
      valor_pago: null,
      forma_pagamento_baixa: null,
      observacao_baixa: null,
    })
    .eq("id", id);
  if (error) return { erro: "Não foi possível desfazer a baixa. Tente novamente." };

  revalidarFinanceiro();
  return {};
}

export type DadosBaixaLote = { pago_em: string; forma_pagamento: FormaPagamento };

/** Baixa em lote sempre quita pelo valor de face de cada título (sem
 * desconto/juro por item) — pra baixa com valor customizado, usa a
 * individual. Roda como um único UPDATE atômico no banco (function
 * `dar_baixa_em_lote_contas_receber`) em vez de um loop de updates um por
 * um — evita ficar com parte do lote baixada e parte não se algo falhar no
 * meio, e o `where situacao != 'pago'` na function não deixa sobrescrever
 * um título que outra pessoa já baixou individualmente enquanto isso. */
export async function darBaixaEmLoteContasReceber(
  ids: string[],
  dados: DadosBaixaLote,
): Promise<{ erro?: string }> {
  if (ids.length === 0) return {};
  if (!dados.pago_em) return { erro: "Informe a data do pagamento." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("dar_baixa_em_lote_contas_receber", {
    p_ids: ids,
    p_pago_em: comoTimestamptzBrasilia(dados.pago_em),
    p_forma_pagamento: dados.forma_pagamento,
  });
  if (error) return { erro: "Não foi possível dar baixa nos títulos selecionados." };

  revalidarFinanceiro();
  return {};
}

export async function darBaixaContaReceber(id: string, dados: DadosBaixa) {
  return darBaixa("contas_receber", id, dados);
}

export async function desfazerBaixaContaReceber(id: string) {
  return desfazerBaixa("contas_receber", id);
}

export async function darBaixaContaPagar(id: string, dados: DadosBaixa) {
  return darBaixa("contas_pagar", id, dados);
}

export async function desfazerBaixaContaPagar(id: string) {
  return desfazerBaixa("contas_pagar", id);
}
