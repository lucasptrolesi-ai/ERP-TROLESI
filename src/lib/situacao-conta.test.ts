import { describe, expect, it } from "vitest";
import { crediarioBloqueadoPorAtraso, diasDeAtraso, situacaoEfetiva } from "@/lib/situacao-conta";

describe("situacaoEfetiva", () => {
  it("mantém pago mesmo com vencimento no passado", () => {
    expect(situacaoEfetiva("pago", "2020-01-01")).toBe("pago");
  });

  it("marca atrasado quando vencimento já passou", () => {
    expect(situacaoEfetiva("em_dia", "2020-01-01")).toBe("atrasado");
  });

  it("mantém em_dia quando vencimento é hoje ou no futuro", () => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    expect(situacaoEfetiva("em_dia", amanha.toISOString().slice(0, 10))).toBe("em_dia");
  });
});

describe("diasDeAtraso", () => {
  it("é 0 no dia do vencimento", () => {
    expect(diasDeAtraso("2026-07-21", "2026-07-21")).toBe(0);
  });

  it("é positivo depois do vencimento", () => {
    expect(diasDeAtraso("2026-07-10", "2026-07-21")).toBe(11);
  });

  it("é negativo antes do vencimento", () => {
    expect(diasDeAtraso("2026-08-01", "2026-07-21")).toBe(-11);
  });
});

describe("crediarioBloqueadoPorAtraso", () => {
  const hoje = "2026-07-21";

  it("não bloqueia com exatamente 5 dias de atraso (regra é > 5)", () => {
    const lancamentos = [{ situacao: "em_dia" as const, vencimento: diasAtrasFrom(hoje, 5) }];
    expect(crediarioBloqueadoPorAtraso(lancamentos, hoje)).toBe(false);
  });

  it("bloqueia com 6+ dias de atraso", () => {
    const lancamentos = [{ situacao: "em_dia" as const, vencimento: diasAtrasFrom(hoje, 6) }];
    expect(crediarioBloqueadoPorAtraso(lancamentos, hoje)).toBe(true);
  });

  it("ignora lançamentos já pagos, mesmo com vencimento antigo", () => {
    const lancamentos = [{ situacao: "pago" as const, vencimento: diasAtrasFrom(hoje, 30) }];
    expect(crediarioBloqueadoPorAtraso(lancamentos, hoje)).toBe(false);
  });

  it("não bloqueia quando não há lançamento atrasado", () => {
    expect(crediarioBloqueadoPorAtraso([{ situacao: "em_dia", vencimento: "2026-08-01" }], hoje)).toBe(false);
  });
});

function diasAtrasFrom(hoje: string, dias: number): string {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia - dias, 12));
  return data.toISOString().slice(0, 10);
}
