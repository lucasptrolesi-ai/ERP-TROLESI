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

  const pedidoTipado = pedido as Pedido;

  // Vendas "aguardando_lancamento_gmax" não geram contas_receber (não afetam
  // o financeiro real ainda) — o parcelamento pra imprimir cupom/promissórias
  // vem de `parcelas_planejadas`, gravado no próprio pedido na hora de
  // salvar. Sintetiza o mesmo formato de `ContaReceber` só pra impressão.
  const parcelasFinal: ContaReceber[] =
    parcelas && parcelas.length > 0
      ? parcelas
      : (pedidoTipado.parcelas_planejadas ?? []).map((p, i) => ({
          id: `planejada-${i}`,
          valor: p.valor,
          vencimento: p.vencimento,
          numero_parcela: i + 1,
          total_parcelas: pedidoTipado.parcelas_planejadas!.length,
        }));

  return { pedido: pedidoTipado, parcelas: parcelasFinal };
}
