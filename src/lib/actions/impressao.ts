"use server";

import { createClient } from "@/lib/supabase/server";
import type { LinhaImpressao } from "@/lib/cupom-linhas";

export type StatusImpressao = {
  status: "pendente" | "impresso" | "erro";
  mensagem: string | null;
};

// Grava um pedido de impressão na fila (solicitacoes_impressao) — o
// print-agent local (rodando na máquina que tem a impressora térmica
// ligada) fica checando essa tabela e imprime o que encontrar. Funciona
// não importa de qual aparelho a venda foi fechada (Mac, Windows, celular),
// diferente de um fetch direto pro loopback de uma máquina específica.
export async function solicitarImpressaoCupom(
  pedidoId: string,
  via: "loja" | "cliente",
  linhas: LinhaImpressao[],
): Promise<{ id: string } | { erro: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitacoes_impressao")
    .insert({ pedido_id: pedidoId, via, linhas })
    .select("id")
    .single();

  if (error) return { erro: error.message };
  return { id: data.id };
}

export async function buscarStatusImpressao(id: string): Promise<StatusImpressao> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitacoes_impressao")
    .select("status, erro")
    .eq("id", id)
    .single();

  if (error || !data) {
    return { status: "erro", mensagem: error?.message ?? "Solicitação de impressão não encontrada." };
  }
  return { status: data.status, mensagem: data.erro };
}
