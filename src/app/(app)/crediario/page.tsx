import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { CrediarioView } from "./crediario-view";
import type { Cliente, CrediarioLancamento } from "@/lib/types";

export default async function CrediarioPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Crediário legado é restrito a administradores (seção 15 do documento mestre — nenhum usuário comum converte
        cliente novo em crediário).
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: clientes }, { data: lancamentos }] = await Promise.all([
    supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
    supabase
      .from("crediario_lancamentos")
      .select("*, clientes(nome)")
      .order("vencimento", { ascending: true }),
  ]);

  return (
    <CrediarioView
      clientes={(clientes ?? []) as Cliente[]}
      lancamentos={(lancamentos ?? []) as unknown as CrediarioLancamento[]}
    />
  );
}
