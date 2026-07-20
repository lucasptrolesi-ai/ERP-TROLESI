import { describe, expect, it } from "vitest";
import { calcularComissao } from "./comissao";

describe("calcularComissao", () => {
  it("comissão percentual simples", () => {
    expect(calcularComissao(1000, 5, null)).toBe(50);
  });
  it("comissão fixa simples", () => {
    expect(calcularComissao(1000, null, 20)).toBe(20);
  });
  it("percentual + fixa somados", () => {
    expect(calcularComissao(1000, 5, 20)).toBe(70);
  });
  it("sem percentual nem fixa configurados, comissão é zero", () => {
    expect(calcularComissao(1000, null, null)).toBe(0);
  });
});
