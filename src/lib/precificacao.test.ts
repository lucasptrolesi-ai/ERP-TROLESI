import { describe, expect, it } from "vitest";
import { calcularPrecoUnitario, MULTIPLICADOR_PADRAO } from "./precificacao";

describe("calcularPrecoUnitario", () => {
  it("multiplica código da peça pelo multiplicador (seção 6 do documento mestre)", () => {
    expect(calcularPrecoUnitario(4.5, 2.8)).toBeCloseTo(12.6, 2);
  });

  it("usa o multiplicador padrão de 2,8 quando esse é o valor do produto", () => {
    expect(calcularPrecoUnitario(10, MULTIPLICADOR_PADRAO)).toBeCloseTo(28, 2);
  });

  it("arredonda pra 2 casas decimais", () => {
    expect(calcularPrecoUnitario(3.333, 2.8)).toBe(9.33);
  });

  it("multiplicador zero é um valor explícito válido (ex: brinde), não deve virar o padrão silenciosamente", () => {
    expect(calcularPrecoUnitario(10, 0)).toBe(0);
  });
});
