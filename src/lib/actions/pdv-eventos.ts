"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizarCampo } from "./erros";
import type { FormaPagamentoEvento } from "@/lib/types";

type ResultadoForm = { erro?: string } | undefined;

function numeroOuZero(valor: FormDataEntryValue | null): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Cadastro simples do estoque de evento — preço digitado direto, sem
 * código×multiplicador. codigo_interno fica de fora do payload de propósito:
 * o trigger definir_codigo_produto_evento (migration 20260813000001) atribui
 * o próximo número sequencial sozinho quando fica null. */
export async function salvarProdutoEvento(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const nome = normalizarCampo(formData.get("nome"), { caixaAlta: true });
  if (!nome) return { erro: "Nome é obrigatório." };

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    nome,
    preco: Math.max(0, numeroOuZero(formData.get("preco"))),
    quantidade_estoque: Math.max(0, Math.trunc(numeroOuZero(formData.get("quantidade_estoque")))),
    ativo: formData.get("ativo") === "on",
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("produtos_evento").update(dados).eq("id", id)
    : await supabase.from("produtos_evento").insert(dados);

  if (error) return { erro: "Não foi possível salvar. Tente novamente." };

  revalidatePath("/pdv-eventos");
  return undefined;
}

export async function excluirProdutoEvento(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  // vendas_evento_itens.produto_evento_id é "on delete set null" (não
  // restrict) de propósito — excluir uma peça de evento nunca é bloqueado
  // por venda vinculada, só desvincula o histórico. Por isso não usa
  // mensagemErroExcluir aqui: o branch de FK dela (código 23503) nunca
  // dispara pra essa tabela, e mencionar "vendas vinculadas" induziria a
  // pensar que existe um bloqueio que não existe (achado de code review).
  const { error } = await supabase.from("produtos_evento").delete().eq("id", id);
  if (error) return { erro: "Não foi possível excluir. Tente novamente." };

  revalidatePath("/pdv-eventos");
  return {};
}

export async function registrarVendaEvento(
  itens: { produto_evento_id: string; nome: string; quantidade: number; preco_unitario: number }[],
  formaPagamento: FormaPagamentoEvento,
  valorDesconto: number,
  numeroParcelas: number,
  idempotencyKey: string,
): Promise<{ erro?: string; venda?: { id: string; numero: number; criado_em: string } }> {
  if (itens.length === 0) return { erro: "Adicione pelo menos uma peça à venda." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("criar_venda_evento", {
    p_itens: itens,
    p_forma_pagamento: formaPagamento,
    p_valor_desconto: valorDesconto,
    p_numero_parcelas: numeroParcelas,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return { erro: error.message };

  // criar_venda_evento só devolve o id (uuid) — numero/criado_em são
  // atribuídos pelo próprio insert dentro da function, então precisam de
  // uma leitura extra pra voltar pro cupom (numeração sequencial e
  // timestamp exatos, não recalculados no cliente).
  const { data: venda, error: erroVenda } = await supabase
    .from("vendas_evento")
    .select("id, numero, criado_em")
    .eq("id", data)
    .single();
  if (erroVenda || !venda) return { erro: "Venda registrada, mas não foi possível carregar os dados pro cupom." };

  revalidatePath("/pdv-eventos");
  return { venda };
}
