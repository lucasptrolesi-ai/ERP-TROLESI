"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";

export type PedidoResolvidoGmax = {
  gmax_pedido_id: number;
  forma_pagamento: string;
  vendedor_id: string | null;
  cliente: { id: string | null; nome: string; cpf_cnpj: string; telefone: string | null };
  itens: { produto_id: string; nome: string; quantidade: number; preco_unitario: number }[];
  parcelas: { valor: number; vencimento: string }[];
};

// Cliente novo, produto novo e forma de pagamento não mapeada são todos
// resolvidos automaticamente pelo agente (decisão do usuário, 2026-07-24) —
// nada bloqueia o lote mais, então o relatório sempre tem só a lista de
// pedidos resolvidos.
export type RelatorioImportacaoGmax = {
  pedidos: PedidoResolvidoGmax[];
};

export type SolicitacaoImportacaoGmax = {
  id: string;
  status: "pendente" | "pronto_para_revisao" | "concluido" | "erro";
  relatorio: RelatorioImportacaoGmax | null;
  erro: string | null;
};

export async function criarSolicitacaoImportacaoGmax(): Promise<{ id?: string; erro?: string }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem importar vendas do GMax." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitacoes_importacao_gmax")
    .insert({ solicitado_por: perfil.id })
    .select("id")
    .single();

  if (error) return { erro: "Não foi possível criar a solicitação. Tente novamente." };
  return { id: data.id as string };
}

export async function buscarStatusImportacaoGmax(id: string): Promise<SolicitacaoImportacaoGmax | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitacoes_importacao_gmax")
    .select("id, status, relatorio, erro")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as SolicitacaoImportacaoGmax;
}

export async function confirmarImportacaoGmax(
  id: string,
): Promise<{ importados?: number; jaExistentes?: number; erro?: string }> {
  const perfil = await getPerfilAtual();
  if (perfil.papel !== "admin") {
    return { erro: "Só administradores podem confirmar a importação." };
  }

  // A function faz tudo numa transação só: trava a linha da solicitação
  // (`for update`), confere que ainda está pronta pra revisão, grava os
  // pedidos/itens/parcelas/baixa de estoque, e marca a própria solicitação
  // como concluída — nada disso depende de um update separado com o client
  // normal (RLS-bound), que não tinha policy pra isso.
  const supabase = await createClient();
  const { data: resultado, error: erroRpc } = await supabase.rpc("importar_pedidos_gmax", {
    p_solicitacao_id: id,
  });
  if (erroRpc) return { erro: erroRpc.message };

  revalidatePath("/pedidos");
  revalidatePath("/estoque");
  revalidatePath("/cadastros");
  revalidatePath("/financeiro");
  revalidatePath("/", "layout");

  return { importados: resultado.importados, jaExistentes: resultado.ja_existentes };
}
