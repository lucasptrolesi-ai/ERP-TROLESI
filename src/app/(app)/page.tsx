import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarFinanceiro } from "@/lib/permissoes";
import { comoLista } from "@/lib/supabase-embed";
import { isoEmDias } from "@/lib/datas";
import { DashboardView } from "./dashboard-view";
import type { PedidoDashboard } from "./dashboard-view";
import type { ContaReceberFinanceiro, Produto } from "@/lib/types";

export default async function DashboardPage() {
  const perfil = await getPerfilAtual();
  const podeVerFinanceiro = podeEditarFinanceiro(perfil.papel);
  const supabase = await createClient();

  // Últimos 40 dias cobrem "hoje" + o mês corrente inteiro pra qualquer dia
  // do mês em que alguém abrir o dashboard.
  const desde = isoEmDias(-40);

  const [{ data: pedidos }, receberResultado, { data: produtos }] = await Promise.all([
    supabase
      .from("pedidos")
      .select(
        "id, numero, status, forma_pagamento, total, criado_em, clientes(nome), pedido_itens(quantidade, preco_unitario, produto_id, produtos(nome))",
      )
      .gte("criado_em", desde)
      .order("criado_em", { ascending: false }),
    podeVerFinanceiro
      ? supabase.from("contas_receber").select("id, valor, vencimento, situacao")
      : Promise.resolve({ data: null }),
    supabase.from("produtos").select("nome, quantidade_estoque, estoque_minimo").eq("ativo", true),
  ]);

  return (
    <DashboardView
      nome={perfil.nome}
      pedidos={comoLista<PedidoDashboard>(pedidos)}
      contasReceber={comoLista<Pick<ContaReceberFinanceiro, "id" | "valor" | "vencimento" | "situacao">>(
        receberResultado.data,
      )}
      produtos={comoLista<Pick<Produto, "nome" | "quantidade_estoque" | "estoque_minimo">>(produtos)}
      podeVerFinanceiro={podeVerFinanceiro}
    />
  );
}
