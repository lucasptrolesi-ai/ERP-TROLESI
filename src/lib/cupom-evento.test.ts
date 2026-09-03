import { describe, expect, it } from "vitest";
import { calcularDescontoCupom } from "./cupom-evento";

describe("calcularDescontoCupom", () => {
  it("percentual: calcula a fração do subtotal", () => {
    expect(calcularDescontoCupom("percentual", 10, 200)).toBeCloseTo(20, 2);
  });

  it("valor: usa o valor fixo direto", () => {
    expect(calcularDescontoCupom("valor", 15, 200)).toBe(15);
  });

  it("nunca desconta mais do que o subtotal vale", () => {
    expect(calcularDescontoCupom("valor", 500, 200)).toBe(200);
  });

  it("percentual de 100% zera o total", () => {
    expect(calcularDescontoCupom("percentual", 100, 150)).toBe(150);
  });

  it("arredonda pra 2 casas decimais", () => {
    expect(calcularDescontoCupom("percentual", 33.33, 100)).toBe(33.33);
  });
});
