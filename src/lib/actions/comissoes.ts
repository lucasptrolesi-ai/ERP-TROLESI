"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { calcularComissao } from "@/lib/comissao";
import type { EventoComissao } from "@/lib/types";

export async function salvarConfigVendedor(
  profileId: string,
  comissaoPercentual: number | null,
  comissaoFixa: number | null,
  eventoGerador: EventoComissao,
  metaMensal: number | null,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("vendedores").upsert(
    {
      profile_id: profileId,
      comissao_percentual: comissaoPercentual,
      comissao_fixa: comissaoFixa,
      evento_gerador: eventoGerador,
      meta_mensal: metaMensal,
    },
    { onConflict: "profile_id" },
  );
  if (error) return { erro: "Não foi possível salvar. Tente novamente." };

  revalidatePath("/comissoes");
  return {};
}

export async function lancarComissao(vendedorId: string, valorBase: number, pedidoId?: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  // Relê a config do vendedor no servidor, não confia no percentual/fixa
  // que o cliente mandar — se a config for atualizada enquanto uma aba
  // antiga estiver aberta com o valor velho carregado, o lançamento usa
  // sempre a taxa atual, nunca uma taxa desatualizada em memória (achado do
  // code-review).
  const { data: vendedor } = await supabase
    .from("vendedores")
    .select("evento_gerador, comissao_percentual, comissao_fixa")
    .eq("id", vendedorId)
    .single();
  if (!vendedor) return { erro: "Vendedor não encontrado." };

  const valorComissao = calcularComissao(valorBase, vendedor.comissao_percentual, vendedor.comissao_fixa);
  const { error } = await supabase.from("comissoes_lancamentos").insert({
    vendedor_id: vendedorId,
    pedido_id: pedidoId ?? null,
    evento: vendedor.evento_gerador,
    valor_base: valorBase,
    valor_comissao: valorComissao,
  });
  if (error) return { erro: "Não foi possível lançar a comissão. Tente novamente." };

  revalidatePath("/comissoes");
  return {};
}
