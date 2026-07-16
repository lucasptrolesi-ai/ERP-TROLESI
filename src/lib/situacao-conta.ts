import { hojeIso } from "@/lib/datas";
import type { SituacaoConta } from "@/lib/types";

/** situação guardada no banco não muda sozinha com o tempo — "atrasado" é
 * sempre calculado na hora, comparando vencimento com hoje, exceto quando
 * já foi baixada como paga (aí prevalece o que está no banco). */
export function situacaoEfetiva(situacao: SituacaoConta, vencimento: string): SituacaoConta {
  if (situacao === "pago") return "pago";
  return vencimento < hojeIso() ? "atrasado" : "em_dia";
}
