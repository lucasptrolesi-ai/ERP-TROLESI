import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { GarantiasView } from "./garantias-view";
import type { Cliente, Garantia, Produto } from "@/lib/types";

export default async function GarantiasPage() {
  const perfil = await getPerfilAtual();
  const podeEditar = podeEditarPedidos(perfil.papel);

  if (!podeEditar) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar Garantias. Fale com um admin se precisar de acesso.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: garantias }, { data: clientes }, { data: produtos }] = await Promise.all([
    supabase
      .from("garantias")
      .select("*, clientes(nome), produtos(nome)")
      .order("criado_em", { ascending: false }),
    supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
    supabase.from("produtos").select("*").eq("ativo", true).order("nome"),
  ]);

  return (
    <GarantiasView
      garantias={(garantias ?? []) as unknown as Garantia[]}
      clientes={(clientes ?? []) as Cliente[]}
      produtos={(produtos ?? []) as Produto[]}
    />
  );
}
