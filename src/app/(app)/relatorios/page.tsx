import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { isoEmDias } from "@/lib/datas";
import { RelatoriosView } from "./relatorios-view";
import type { PedidoRelatorio } from "@/lib/relatorios";
import type { Abatimento, Garantia, Produto } from "@/lib/types";

export default async function RelatoriosPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Relatórios são restritos a administradores.
      </div>
    );
  }

  const supabase = await createClient();
  const desde = isoEmDias(-395);

  const [{ data: pedidos }, { data: abatimentos }, { data: garantias }, { data: produtos }] = await Promise.all([
    supabase
      .from("pedidos")
      .select(
        "id, numero, status, forma_pagamento, total, criado_em, clientes(nome), pedido_itens(quantidade, preco_unitario, produto_id, produtos(nome))",
      )
      .gte("criado_em", desde)
      .order("criado_em", { ascending: false }),
    supabase.from("abatimentos").select("*, clientes(nome)").gte("criado_em", desde),
    supabase.from("garantias").select("*, clientes(nome), produtos(nome)").gte("criado_em", desde),
    supabase.from("produtos").select("*").eq("ativo", true),
  ]);

  return (
    <RelatoriosView
      pedidos={(pedidos ?? []) as unknown as PedidoRelatorio[]}
      abatimentos={(abatimentos ?? []) as unknown as Abatimento[]}
      garantias={(garantias ?? []) as unknown as Garantia[]}
      produtos={(produtos ?? []) as Produto[]}
    />
  );
}
