"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { avaliarPecaParaAbatimento, valorAbatimentoValido, type PecaAbatimento } from "@/lib/abatimento";
import { parseMoeda } from "@/lib/parse-moeda";
import { normalizarCampo } from "./erros";

type ResultadoForm = { erro?: string } | undefined;

export async function registrarAbatimento(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const clienteId = normalizarCampo(formData.get("cliente_id"));
  if (!clienteId) return { erro: "Selecione um cliente." };

  const peca: PecaAbatimento = {
    material: normalizarCampo(formData.get("material")),
    danificada: formData.get("danificada") === "on",
    marcaPresente: formData.get("marca_presente") === "on",
    temPedra: formData.get("tem_pedra") === "on",
    temPerola: formData.get("tem_perola") === "on",
    ehFitaOuFio: formData.get("eh_fita_ou_fio") === "on",
    ultimaColecao: formData.get("ultima_colecao") === "on",
    ehRelogio: formData.get("eh_relogio") === "on",
  };

  const avaliacao = avaliarPecaParaAbatimento(peca);

  const baseElegivelInformada = parseMoeda(String(formData.get("base_elegivel") ?? "0"));
  const valorAtribuido = parseMoeda(String(formData.get("valor_atribuido") ?? "0"));

  if (avaliacao.elegivel && baseElegivelInformada > 0 && !valorAbatimentoValido(valorAtribuido, baseElegivelInformada)) {
    return { erro: `Valor de abatimento acima do limite de 20% da base elegível (R$${(baseElegivelInformada * 0.2).toFixed(2)}).` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("abatimentos").insert({
    cliente_id: clienteId,
    pedido_id: normalizarCampo(formData.get("pedido_id")),
    material: peca.material,
    tipo_peca: normalizarCampo(formData.get("tipo_peca")),
    marca_presente: peca.marcaPresente,
    danificada: peca.danificada,
    tem_pedra: peca.temPedra,
    tem_perola: peca.temPerola,
    eh_fita_ou_fio: peca.ehFitaOuFio,
    ultima_colecao: peca.ultimaColecao,
    eh_relogio: peca.ehRelogio,
    estado_descricao: normalizarCampo(formData.get("estado_descricao")),
    motivo_avaliacao: avaliacao.motivo ?? null,
    valor_atribuido: avaliacao.elegivel ? valorAtribuido : null,
    status: avaliacao.elegivel ? "avaliando" : "reprovado",
  });

  if (error) return { erro: "Não foi possível registrar o abatimento. Tente novamente." };

  revalidatePath("/abatimentos");
  return undefined;
}

export async function aprovarAbatimento(id: string, justificativa?: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("aprovar_abatimento", {
    p_id: id,
    p_valor_final: null,
    p_justificativa: justificativa ?? null,
  });
  if (error) return { erro: error.message };
  revalidatePath("/abatimentos");
  return {};
}

export async function reprovarAbatimento(id: string, justificativa?: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reprovar_abatimento", { p_id: id, p_justificativa: justificativa ?? null });
  if (error) return { erro: error.message };
  revalidatePath("/abatimentos");
  return {};
}
