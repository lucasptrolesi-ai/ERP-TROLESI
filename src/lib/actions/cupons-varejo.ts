"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, normalizarCampo } from "./erros";

// Cupom de desconto no PDV Varejo (Fase 2 de 3 — cliente, cupom, cashback — pedido do usuário
// 2026-10-19/20), espelhando o cupom do PDV Eventos (src/lib/actions/pdv-eventos.ts,
// salvarCupomEvento) quase igual, só trocando a tabela. RLS (`20261020000001`) já restringe
// insert/update/delete a admin+vendedor — não precisa reforçar aqui.

type ResultadoForm = { erro?: string } | undefined;

function numeroOuZero(valor: FormDataEntryValue | null): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export async function salvarCupomVarejo(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const codigo = normalizarCampo(formData.get("codigo"), { caixaAlta: true });
  if (!codigo) return { erro: "Código é obrigatório." };
  const tipo = formData.get("tipo") === "percentual" ? "percentual" : "valor";
  const valor = numeroOuZero(formData.get("valor"));
  if (valor <= 0) return { erro: "Valor precisa ser maior que zero." };
  if (tipo === "percentual" && valor > 100) return { erro: "Percentual não pode passar de 100." };

  const supabase = await createClient();
  const id = normalizarCampo(formData.get("id"));
  const dados = { codigo, tipo, valor, ativo: formData.get("ativo") === "on" };

  const { error } = id
    ? await supabase.from("cupons_varejo").update(dados).eq("id", id)
    : await supabase.from("cupons_varejo").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error, "código") };

  revalidatePath("/varejo/cupons");
  revalidatePath("/varejo/pdv");
  return undefined;
}
