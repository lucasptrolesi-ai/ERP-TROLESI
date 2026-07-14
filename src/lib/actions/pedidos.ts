"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FormaPagamento, ItemCarrinho, Parcela, StatusPedido } from "@/lib/types";

export async function criarPedido(
  clienteId: string,
  itens: ItemCarrinho[],
  formaPagamento: FormaPagamento,
  status: Extract<StatusPedido, "orcamento" | "faturado">,
  ajuste: {
    valorDesconto: number;
    percentualDesconto: number | null;
    valorAcrescimo: number;
    percentualAcrescimo: number | null;
  },
  parcelas: Parcela[],
): Promise<{ erro?: string; pedidoId?: string }> {
  if (!clienteId) return { erro: "Selecione um cliente." };
  if (itens.length === 0) return { erro: "Adicione pelo menos um produto ao pedido." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("criar_pedido", {
    p_cliente_id: clienteId,
    p_forma_pagamento: formaPagamento,
    p_status: status,
    p_itens: itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
    })),
    p_valor_desconto: ajuste.valorDesconto,
    p_percentual_desconto: ajuste.percentualDesconto,
    p_valor_acrescimo: ajuste.valorAcrescimo,
    p_percentual_acrescimo: ajuste.percentualAcrescimo,
    p_parcelas: parcelas.length > 0 ? parcelas : null,
  });

  if (error) {
    // A function já levanta mensagens de negócio legíveis (estoque
    // insuficiente, permissão, etc.) — repassa direto em vez de traduzir.
    return { erro: error.message };
  }

  revalidatePath("/pedidos");
  revalidatePath("/estoque");
  // Pedido faturado com parcelas (cartão/promissória) cria contas_receber
  // — o Financeiro e o sininho de vencimentos (no layout raiz) precisam
  // saber disso pra não ficarem mostrando dado desatualizado.
  revalidatePath("/financeiro");
  revalidatePath("/", "layout");
  return { pedidoId: data as string };
}

export async function ajustarPedido(
  pedidoId: string,
  valorDesconto: number,
  valorAcrescimo: number,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("ajustar_valor_pedido", {
    p_pedido_id: pedidoId,
    p_valor_desconto: valorDesconto,
    p_valor_acrescimo: valorAcrescimo,
  });

  if (error) return { erro: error.message };

  revalidatePath("/pedidos");
  return {};
}

export async function extornarPedido(pedidoId: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("extornar_pedido", { p_pedido_id: pedidoId });

  if (error) return { erro: error.message };

  revalidatePath("/pedidos");
  revalidatePath("/estoque");
  // Extorno apaga as contas_receber do pedido — mesma razão do comentário
  // em criarPedido.
  revalidatePath("/financeiro");
  revalidatePath("/", "layout");
  return {};
}
