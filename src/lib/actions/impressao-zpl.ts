"use server";

import { createClient } from "@/lib/supabase/server";

// Fila genérica de impressão ZPL (2026-11-13) -- pra documento que não é etiqueta de peça, ver
// migration 20261113000001_fila_impressao_zpl_generica.sql e print-agent/agent.js
// (processarPendentesImpressaoZpl). O app monta o ZPL inteiro (ex: src/lib/varejo/divida-atacado-
// zpl.ts) e só grava pronto aqui -- o print-agent apenas ENVIA, mesmo espírito do Módulo Etiquetas.

type ErroPg = { code?: string; message: string };

function mensagem(erro: ErroPg): string {
  if (erro.code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir. Tente novamente.";
}

export async function solicitarImpressaoZpl(zpl: string): Promise<{ erro?: string; id?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("solicitacoes_impressao_zpl").insert({ zpl }).select("id").single();
  if (error || !data) return { erro: mensagem(error ?? { message: "" }) };
  return { id: data.id as string };
}

export type StatusImpressaoZpl = { status: "pendente" | "impresso" | "erro"; mensagem: string | null };

export async function buscarStatusImpressaoZpl(id: string): Promise<StatusImpressaoZpl> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("solicitacoes_impressao_zpl").select("status, erro").eq("id", id).single();
  if (error || !data) {
    return { status: "erro", mensagem: error?.message ?? "Solicitação não encontrada." };
  }
  return { status: data.status, mensagem: data.erro };
}
