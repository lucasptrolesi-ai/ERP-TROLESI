import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { AbatimentosView } from "./abatimentos-view";
import type { Abatimento, Cliente } from "@/lib/types";

export default async function AbatimentosPage() {
  const perfil = await getPerfilAtual();
  const podeEditar = podeEditarPedidos(perfil.papel);

  if (!podeEditar) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar Abatimentos. Fale com um admin se precisar de acesso.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: abatimentos }, { data: clientes }] = await Promise.all([
    supabase
      .from("abatimentos")
      .select("*, clientes(nome)")
      .order("criado_em", { ascending: false }),
    supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
  ]);

  return (
    <AbatimentosView
      abatimentos={(abatimentos ?? []) as unknown as Abatimento[]}
      clientes={(clientes ?? []) as Cliente[]}
      // Só admin tem a permissão granular `aprovar_valor_abatimento` hoje —
      // ainda não existe UI de concessão de permissão pra outros papéis, então
      // mostrar o botão pra vendedor só levaria a um erro de permissão em todo
      // clique (achado do code-review). Ajustar quando essa UI existir.
      podeAprovar={perfil.papel === "admin"}
    />
  );
}
