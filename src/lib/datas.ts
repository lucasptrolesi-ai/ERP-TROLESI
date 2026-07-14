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

// Colunas `date` (ex: vencimento) chegam como "AAAA-MM-DD" puro — vira meio-
// dia local antes de formatar, self-consistente independente do fuso do
// runtime. Colunas `timestamptz` (ex: pago_em) já vêm com hora e offset —
// concatenar mais um "T00:00:00" em cima quebra a string (virava "Invalid
// Date" na tela); formata direto com o fuso de Brasília explícito, senão o
// dia pode deslocar dependendo do fuso do servidor/navegador.
export function formatarDataIso(iso: string): string {
  if (iso.includes("T")) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO_HORARIO,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  }
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

// Converte uma data "AAAA-MM-DD" escolhida pelo usuário (sempre pensada no
// fuso de Brasília) num timestamptz seguro pra gravar — meio-dia com o
// offset de Brasília explícito, longe o bastante da meia-noite UTC pra
// nunca virar o dia errado ao ser lido de volta.
export function comoTimestamptzBrasilia(dataIso: string): string {
  return `${dataIso}T12:00:00-03:00`;
}
