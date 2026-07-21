import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { FreteView } from "./frete-view";
import type { Expedicao } from "@/lib/types";

export default async function FretePage() {
  const perfil = await getPerfilAtual();
  const podeEditar = podeEditarPedidos(perfil.papel);

  if (!podeEditar) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar Frete/Expedição.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: expedicoes }, { data: pedidosSemExpedicao }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("*, pedidos(numero, clientes(nome))")
      .order("criado_em", { ascending: false }),
    supabase
      .from("pedidos")
      .select("id, numero, total, clientes(nome)")
      .in("status", ["faturado", "aguardando_lancamento_gmax", "lancado_gmax"])
      .order("criado_em", { ascending: false })
      .limit(200),
  ]);

  const idsComExpedicao = new Set((expedicoes ?? []).map((e) => e.pedido_id));
  const pendentes = (pedidosSemExpedicao ?? []).filter((p) => !idsComExpedicao.has(p.id));

  return (
    <FreteView
      expedicoes={(expedicoes ?? []) as unknown as Expedicao[]}
      pendentes={pendentes as unknown as { id: string; numero: number; total: number; clientes: { nome: string } | null }[]}
    />
  );
}
