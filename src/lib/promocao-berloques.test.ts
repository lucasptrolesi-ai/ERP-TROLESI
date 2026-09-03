import { describe, expect, it } from "vitest";
import { calcularDescontoBerloques } from "./promocao-berloques";

describe("calcularDescontoBerloques", () => {
  it("sem desconto abaixo de 3 unidades", () => {
    const itens = [{ codigo_interno: "BL01", quantidade: 2, preco_unitario: 60 }];
    expect(calcularDescontoBerloques(itens)).toBe(0);
  });

  it("conta qualquer combinação de códigos BL, não só o mesmo", () => {
    const itens = [
      { codigo_interno: "BL01", quantidade: 1, preco_unitario: 60 },
      { codigo_interno: "BL02", quantidade: 1, preco_unitario: 55 },
      { codigo_interno: "BL03", quantidade: 1, preco_unitario: 70 },
    ];
    // total normal 185, promocional 3 × 49,90 = 149,70
    expect(calcularDescontoBerloques(itens)).toBeCloseTo(35.3, 2);
  });

  it("ignora peças que não são berloque (prefixo diferente)", () => {
    const itens = [
      { codigo_interno: "BL01", quantidade: 3, preco_unitario: 60 },
      { codigo_interno: "PA01", quantidade: 5, preco_unitario: 100 },
    ];
    // só os 3 berloques entram na conta: 180 - 149,70
    expect(calcularDescontoBerloques(itens)).toBeCloseTo(30.3, 2);
  });

  it("nunca aumenta o preço se o normal já é menor que o promocional", () => {
    const itens = [{ codigo_interno: "BL01", quantidade: 3, preco_unitario: 40 }];
    expect(calcularDescontoBerloques(itens)).toBe(0);
  });

  it("BLF não é BL — prefixo tem que bater exatamente", () => {
    const itens = [{ codigo_interno: "BLF01", quantidade: 3, preco_unitario: 60 }];
    expect(calcularDescontoBerloques(itens)).toBe(0);
  });
});
