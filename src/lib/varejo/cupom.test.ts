import { describe, expect, it } from "vitest";
import { calcularDescontoCupomVarejo } from "./cupom";

describe("calcularDescontoCupomVarejo", () => {
  it("percentual: calcula a fração do total de itens", () => {
    expect(calcularDescontoCupomVarejo("percentual", 10, 200)).toBeCloseTo(20, 2);
  });

  it("valor: usa o valor fixo direto", () => {
    expect(calcularDescontoCupomVarejo("valor", 15, 200)).toBe(15);
  });

  it("nunca desconta mais do que o total de itens vale", () => {
    expect(calcularDescontoCupomVarejo("valor", 500, 200)).toBe(200);
  });

  it("percentual de 100% zera o total", () => {
    expect(calcularDescontoCupomVarejo("percentual", 100, 150)).toBe(150);
  });

  it("arredonda pra 2 casas decimais", () => {
    expect(calcularDescontoCupomVarejo("percentual", 33.33, 100)).toBe(33.33);
  });
});
