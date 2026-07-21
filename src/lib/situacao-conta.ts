import { hojeIso } from "@/lib/datas";
import type { SituacaoConta } from "@/lib/types";

/** situação guardada no banco não muda sozinha com o tempo — "atrasado" é
 * sempre calculado na hora, comparando vencimento com hoje, exceto quando
 * já foi baixada como paga (aí prevalece o que está no banco). */
export function situacaoEfetiva(situacao: SituacaoConta, vencimento: string): SituacaoConta {
  if (situacao === "pago") return "pago";
  return vencimento < hojeIso() ? "atrasado" : "em_dia";
}

/** Dias corridos entre o vencimento (YYYY-MM-DD) e hoje — positivo quando
 * já venceu. Meio-dia UTC evita o vencimento cair num dia diferente por
 * causa de DST/fuso na conversão pra epoch. */
export function diasDeAtraso(vencimento: string, hoje: string = hojeIso()): number {
  const [anoV, mesV, diaV] = vencimento.split("-").map(Number);
  const [anoH, mesH, diaH] = hoje.split("-").map(Number);
  const umDiaMs = 86400000;
  return Math.round((Date.UTC(anoH, mesH - 1, diaH, 12) - Date.UTC(anoV, mesV - 1, diaV, 12)) / umDiaMs);
}

/** Bloqueio de crediário legado (seção 15 do documento mestre, decisão
 * registrada em pending_decisions): atraso > 5 dias (a partir do 6º dia)
 * em qualquer lançamento não pago já bloqueia o cliente — calculado na
 * hora, nunca lido de uma flag armazenada que ficaria desatualizada. */
export function crediarioBloqueadoPorAtraso(
  lancamentos: { situacao: SituacaoConta; vencimento: string }[],
  hoje: string = hojeIso(),
): boolean {
  return lancamentos.some((l) => l.situacao !== "pago" && diasDeAtraso(l.vencimento, hoje) > 5);
}
