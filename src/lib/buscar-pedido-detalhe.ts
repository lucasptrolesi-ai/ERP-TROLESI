import { createClient } from "@/lib/supabase/server";
import type { ContaReceber, Pedido } from "@/lib/types";

export async function buscarPedidoDetalhe(
  id: string,
): Promise<{ pedido: Pedido; parcelas: ContaReceber[] } | null> {
  const supabase = await createClient();

  const [{ data: pedido }, { data: parcelas }] = await Promise.all([
    supabase
      .from("pedidos")
      .select(
        "*, clientes(nome, cpf_cnpj, endereco, bairro, cidade, uf), pedido_itens(quantidade, preco_unitario, produtos(nome))",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("contas_receber")
      .select("id, valor, vencimento, numero_parcela, total_parcelas")
      .eq("pedido_id", id)
      .order("numero_parcela"),
  ]);

  if (!pedido) return null;
  return { pedido: pedido as Pedido, parcelas: parcelas ?? [] };
}
