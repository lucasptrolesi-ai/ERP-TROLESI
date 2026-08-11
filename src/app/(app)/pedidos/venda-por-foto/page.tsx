import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { VendaPorFotoView } from "./venda-por-foto-view";

export default async function VendaPorFotoPage() {
  const perfil = await getPerfilAtual();
  if (!podeEditarPedidos(perfil.papel)) redirect("/pedidos");

  const supabase = await createClient();
  const [{ data: clientes }, { data: produtos }] = await Promise.all([
    supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
    supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
  ]);

  return <VendaPorFotoView clientes={clientes ?? []} produtos={produtos ?? []} />;
}
