import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { hojeIso } from "@/lib/datas";
import { PedidosView } from "./pedidos-view";
import type { CotacaoDiaria } from "@/lib/types";

export default async function PedidosPage() {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();

  const [{ data: pedidos }, { data: clientes }, { data: produtos }, { data: faixas }, { data: cotacoesHoje }] =
    await Promise.all([
      supabase
        .from("pedidos")
        .select(
          "*, clientes(nome, cpf_cnpj, endereco, bairro, cidade, uf), pedido_itens(quantidade, preco_unitario, produtos(nome)), pedido_pagamentos_mistos(forma_pagamento, valor)",
        )
        .order("criado_em", { ascending: false }),
      supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
      supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
      supabase.from("faixas_parcelamento").select("forma_pagamento, valor_minimo, parcelas_sem_juros"),
      supabase.from("cotacoes_diarias").select("*").eq("data", hojeIso()),
    ]);

  return (
    <PedidosView
      papelAtual={perfil.papel}
      pedidos={pedidos ?? []}
      clientes={clientes ?? []}
      produtos={produtos ?? []}
      faixasParcelamento={faixas ?? []}
      cotacoesHoje={(cotacoesHoje ?? []) as CotacaoDiaria[]}
    />
  );
}
