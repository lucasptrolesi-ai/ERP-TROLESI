import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { comoLista } from "@/lib/supabase-embed";
import { ConferenciaView, type ItemNota } from "./conferencia-view";
import type { NotaFiscal } from "@/lib/types";

export default async function ConferenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: nota } = await supabase
    .from("notas_fiscais")
    .select(
      "id, pedido_id, cliente_id, status, xml, chave_acesso, protocolo, valor_total, cfop, natureza_operacao, serie, validada_por, validada_em, criado_em, pedidos(numero, criado_em), clientes(nome, razao_social)",
    )
    .eq("id", id)
    .single();

  if (!nota) notFound();

  const { data: itens } = await supabase
    .from("pedido_itens")
    .select("quantidade, preco_unitario, produtos(nome, ncm, csosn)")
    .eq("pedido_id", nota.pedido_id);

  return <ConferenciaView nota={nota as unknown as NotaFiscal} itens={comoLista<ItemNota>(itens)} />;
}
