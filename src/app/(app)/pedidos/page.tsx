import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { PedidosView } from "./pedidos-view";

export default async function PedidosPage() {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();

  const [{ data: pedidos }, { data: clientes }, { data: produtos }, { data: faixas }] = await Promise.all([
    supabase
      .from("pedidos")
      .select(
        "*, clientes(nome, cpf_cnpj, endereco, bairro, cidade, uf), pedido_itens(quantidade, preco_unitario, produtos(nome))",
      )
      .order("criado_em", { ascending: false }),
    supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
    supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
    supabase.from("faixas_parcelamento").select("forma_pagamento, valor_minimo, parcelas_sem_juros"),
  ]);

  return (
    <PedidosView
      papelAtual={perfil.papel}
      pedidos={pedidos ?? []}
      clientes={clientes ?? []}
      produtos={produtos ?? []}
      faixasParcelamento={faixas ?? []}
    />
  );
}
