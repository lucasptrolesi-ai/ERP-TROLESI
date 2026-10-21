import { describe, expect, it } from "vitest";
import { espacoParaCashback } from "./cashback";

describe("espacoParaCashback", () => {
  it("sem desconto nem acréscimo, o espaço é o próprio total de itens", () => {
    expect(espacoParaCashback(100, 0, 0)).toBe(100);
  });

  it("desconto do carrinho reduz o espaço disponível", () => {
    expect(espacoParaCashback(100, 30, 0)).toBe(70);
  });

  it("acréscimo do carrinho AUMENTA o espaço disponível — regressão do achado de code review", () => {
    expect(espacoParaCashback(100, 0, 20)).toBe(120);
  });

  it("desconto e acréscimo juntos combinam normalmente", () => {
    expect(espacoParaCashback(100, 30, 20)).toBe(90);
  });

  it("pode dar negativo quando o desconto passa do total — quem usa decide o que fazer com isso", () => {
    expect(espacoParaCashback(50, 60, 0)).toBe(-10);
  });
});
