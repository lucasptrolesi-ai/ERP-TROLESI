"use server";

import { createClient } from "@/lib/supabase/server";
import { hojeIso } from "@/lib/datas";
import type { CashbackDisponivel } from "@/lib/varejo/tipos";

// Cashback no PDV Varejo (Fase 3 de 3 — cliente, cupom, cashback — pedido do usuário 2026-10-19/21).
// Conceder/resgatar cashback viajam JUNTO com a venda, dentro da mesma função atômica
// (registrar_venda_varejo_com_cashback, chamada por registrarVenda em ./varejo.ts) — não têm action
// própria aqui porque, se fossem chamadas separadas depois da venda, uma falha no meio deixaria a
// venda com o desconto aplicado e o cashback intacto pra usar de novo (achado de code review,
// 2026-10-21; ver DECISIONS.md). Esta é só a leitura.

/** Cashback disponível (não usado, não vencido) de um cliente — buscado ao selecionar o cliente no
 * PDV, pra "apontar automático" sem o vendedor precisar ir atrás. */
export async function buscarCashbackDisponivel(clienteId: string): Promise<CashbackDisponivel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cashback_lancamentos")
    .select("id, valor, vencimento")
    .eq("cliente_id", clienteId)
    .eq("situacao", "disponivel")
    .gte("vencimento", hojeIso())
    .order("vencimento");
  if (error || !data) return [];
  return data as CashbackDisponivel[];
}
