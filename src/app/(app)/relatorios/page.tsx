import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { isoEmDias } from "@/lib/datas";
import { RelatoriosView } from "./relatorios-view";
import type { PedidoRelatorio } from "@/lib/relatorios";
import type { Abatimento, Cliente, CrediarioLancamento, Expedicao, Garantia, Produto } from "@/lib/types";

type ComissaoRelatorio = { valor_comissao: number; criado_em: string };
type PedidoComCliente = PedidoRelatorio & { cliente_id: string | null };

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

  const [
    { data: pedidos },
    { data: abatimentos },
    { data: garantias },
    { data: produtos },
    { data: crediarioLancamentos },
    { data: expedicoes },
    { data: comissoes },
    { data: clientes },
  ] = await Promise.all([
    supabase
      .from("pedidos")
      .select(
        "id, numero, status, forma_pagamento, total, criado_em, cliente_id, clientes(nome), pedido_itens(quantidade, preco_unitario, produto_id, produtos(nome))",
      )
      .gte("criado_em", desde)
      .order("criado_em", { ascending: false }),
    supabase.from("abatimentos").select("*, clientes(nome)").gte("criado_em", desde),
    supabase.from("garantias").select("*, clientes(nome), produtos(nome)").gte("criado_em", desde),
    supabase.from("produtos").select("*").eq("ativo", true),
    supabase.from("crediario_lancamentos").select("*, clientes(nome)"),
    supabase.from("expedicoes").select("*, pedidos(numero, clientes(nome))").gte("criado_em", desde),
    supabase.from("comissoes_lancamentos").select("valor_comissao, criado_em").gte("criado_em", desde),
    supabase.from("clientes").select("*").eq("ativo", true),
  ]);

  return (
    <RelatoriosView
      pedidos={(pedidos ?? []) as unknown as PedidoComCliente[]}
      abatimentos={(abatimentos ?? []) as unknown as Abatimento[]}
      garantias={(garantias ?? []) as unknown as Garantia[]}
      produtos={(produtos ?? []) as Produto[]}
      crediarioLancamentos={(crediarioLancamentos ?? []) as unknown as CrediarioLancamento[]}
      expedicoes={(expedicoes ?? []) as unknown as Expedicao[]}
      comissoes={(comissoes ?? []) as ComissaoRelatorio[]}
      clientes={(clientes ?? []) as Cliente[]}
    />
  );
}
