import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { ComissoesView } from "./comissoes-view";
import type { Vendedor } from "@/lib/types";

type VendedorProfile = { id: string; nome: string; papel: string; ativo: boolean };
type ComissaoLancamento = {
  id: string;
  vendedor_id: string;
  valor_base: number;
  valor_comissao: number;
  evento: string;
  estornado: boolean;
  criado_em: string;
};

export default async function ComissoesPage() {
  const perfil = await getPerfilAtual();

  if (perfil.papel !== "admin") {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Comissões são restritas a administradores.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: vendedoresProfiles }, { data: configs }, { data: lancamentos }] = await Promise.all([
    supabase.from("profiles").select("id, nome, papel, ativo").eq("papel", "vendedor").eq("ativo", true),
    supabase.from("vendedores").select("*"),
    supabase.from("comissoes_lancamentos").select("*").order("criado_em", { ascending: false }).limit(100),
  ]);

  return (
    <ComissoesView
      vendedoresProfiles={(vendedoresProfiles ?? []) as VendedorProfile[]}
      configs={(configs ?? []) as Vendedor[]}
      lancamentos={(lancamentos ?? []) as ComissaoLancamento[]}
    />
  );
}
