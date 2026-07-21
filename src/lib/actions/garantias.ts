"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { avaliarGarantiaFolheado } from "@/lib/garantia";
import { normalizarCampo } from "./erros";
import type { GarantiaProdutoTipo } from "@/lib/types";

type ResultadoForm = { erro?: string } | undefined;

export async function registrarGarantia(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const clienteId = normalizarCampo(formData.get("cliente_id"));
  if (!clienteId) return { erro: "Selecione um cliente." };

  const tipo = (normalizarCampo(formData.get("tipo")) ?? "sem_garantia") as GarantiaProdutoTipo;

  let aprovado: boolean | null = null;
  let justificativaAuto: string | null = null;

  if (tipo === "folheado_ouro") {
    const avaliacao = avaliarGarantiaFolheado({
      percentualDescascamento: Number(String(formData.get("percentual_descascamento") ?? "0").replace(",", ".")) || 0,
      marcaPresente: formData.get("marca_presente") === "on",
      pecaCompleta: formData.get("peca_completa") === "on",
      alianca: formData.get("alianca") === "on",
    });
    aprovado = avaliacao.aprovado;
    justificativaAuto = avaliacao.motivo ?? null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("garantias").insert({
    cliente_id: clienteId,
    produto_id: normalizarCampo(formData.get("produto_id")),
    pedido_id: normalizarCampo(formData.get("pedido_id")),
    tipo,
    percentual_descascamento: Number(String(formData.get("percentual_descascamento") ?? "0").replace(",", ".")) || null,
    marca_presente: formData.get("marca_presente") === "on",
    peca_completa: formData.get("peca_completa") === "on",
    limpeza_realizada: formData.get("limpeza_realizada") === "on",
    sinais_mau_uso: formData.get("sinais_mau_uso") === "on",
    alianca: formData.get("alianca") === "on",
    parecer: normalizarCampo(formData.get("parecer")),
    aprovado,
    justificativa: justificativaAuto ?? normalizarCampo(formData.get("justificativa")),
    numero_serie: normalizarCampo(formData.get("numero_serie")),
    status_orient: tipo === "orient" ? "aguardando_fabricante" : null,
  });

  if (error) return { erro: "Não foi possível registrar a garantia. Tente novamente." };

  revalidatePath("/garantias");
  return undefined;
}

/** Decisão manual de garantia (Orient — decisão pertence à fabricante mas
 * alguém aqui registra o resultado —, autenticidade prata/aço, ou uma
 * revisão manual de um veredito automático de folheado a ouro). Exige a
 * permissão granular `aprovar_reprovar_garantia` — nunca um UPDATE direto
 * na tabela, senão não fica auditado (achado do code-review). */
export async function decidirGarantia(
  id: string,
  aprovado: boolean,
  justificativa?: string,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("aprovar_reprovar_garantia", {
    p_id: id,
    p_aprovado: aprovado,
    p_justificativa: justificativa ?? null,
  });
  if (error) return { erro: error.message };
  revalidatePath("/garantias");
  return {};
}
