import type { GarantiaProdutoTipo } from "@/lib/types";

export type AvaliacaoGarantiaFolheado = { aprovado: boolean; motivo?: string };

/** Garantia de folheado a ouro (seção 12): descascamento ≥ 80%, marca
 * presente (obrigatória), peça completa. Aliança folheada nunca tem
 * garantia, mesmo com descascamento alto. Nunca aprovar automaticamente
 * por relato do cliente — isso aqui é a regra que valida uma análise já
 * feita, não substitui a inspeção física. */
export function avaliarGarantiaFolheado(dados: {
  percentualDescascamento: number;
  marcaPresente: boolean;
  pecaCompleta: boolean;
  alianca: boolean;
}): AvaliacaoGarantiaFolheado {
  if (dados.alianca) return { aprovado: false, motivo: "Aliança folheada não tem garantia." };
  if (!dados.marcaPresente) return { aprovado: false, motivo: "Marca não presente na peça." };
  if (!dados.pecaCompleta) return { aprovado: false, motivo: "Peça incompleta." };
  if (dados.percentualDescascamento < 80) {
    return { aprovado: false, motivo: "Descascamento abaixo de 80%." };
  }
  return { aprovado: true };
}

/** Prata 925 / aço cirúrgico (seção 13): garantia é SEMPRE só de
 * autenticidade do material — nunca cobre risco, quebra, amassado,
 * desgaste, escurecimento, sujeira, falta de manutenção, mau uso, perda de
 * componente. Precisa estar classificada assim no schema/enum, não só em
 * texto de UI (por isso essa função existe: é a barreira de código, não
 * uma label solta que alguém poderia mudar sem querer). */
export function ehGarantiaSoDeAutenticidade(tipo: GarantiaProdutoTipo): boolean {
  return tipo === "autenticidade_prata_aco";
}
