"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroExcluir, normalizarCampo } from "./erros";
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
  const { error } = await supabase.from("produtos_evento").delete().eq("id", id);
  if (error) return { erro: mensagemErroExcluir(error, "vendas do evento") };

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

export type StatusEtiqueta = { status: "pendente" | "impresso" | "erro"; mensagem: string | null };

// Mesmo padrão de fila/polling do cupom (ver src/lib/actions/impressao.ts)
// — grava o pedido de etiqueta na fila; o print-agent rodando na máquina
// com a Argox instalada (SERVIDOR) consome e imprime de verdade.
export async function solicitarImpressaoEtiqueta(
  codigoInterno: string,
  nome: string,
): Promise<{ id: string } | { erro: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitacoes_etiqueta")
    .insert({ codigo_interno: codigoInterno, nome })
    .select("id")
    .single();

  if (error) return { erro: error.message };
  return { id: data.id };
}

export async function buscarStatusEtiqueta(id: string): Promise<StatusEtiqueta> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("solicitacoes_etiqueta").select("status, erro").eq("id", id).single();

  if (error || !data) {
    return { status: "erro", mensagem: error?.message ?? "Solicitação de etiqueta não encontrada." };
  }
  return { status: data.status, mensagem: data.erro };
}
