const FUSO_HORARIO = "America/Sao_Paulo";

// A Trolesi opera só no Brasil — usar o fuso fixo em vez de toISOString()
// (que é sempre UTC) evita o bug de virar o "dia" 3h antes da meia-noite
// local (toISOString já mostra o dia seguinte entre 21h e 23h59 em SP),
// o que categorizava contas como atrasadas cedo demais e sumia com o
// alerta de "vencendo hoje" nesse intervalo.
function paraIso(data: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_HORARIO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${obter("year")}-${obter("month")}-${obter("day")}`;
}

export function hojeIso(): string {
  return paraIso(new Date());
}

export function isoEmDias(dias: number): string {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return paraIso(data);
}

export function formatarDataIso(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}
