import { createClient } from "@/lib/supabase/server";
import { PedidosView } from "./pedidos-view";

export default async function PedidosPage() {
  const supabase = await createClient();
  const { data: clientes } = await supabase
    .from("clientes")
    .select("*")
    .eq("ativo", true)
    .order("nome");

  return <PedidosView clientes={clientes ?? []} />;
}
