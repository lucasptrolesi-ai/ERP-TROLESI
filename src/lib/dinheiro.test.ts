import { describe, expect, it } from "vitest";
import { arredondarMoeda, lerMoeda } from "@/lib/dinheiro";

describe("arredondarMoeda (HALF_UP, empate afasta do zero)", () => {
  it("decide o empate sem erro de float", () => {
    expect(arredondarMoeda(1.005)).toBe(1.01);
    expect(arredondarMoeda(2.675)).toBe(2.68);
    expect(arredondarMoeda(1.115)).toBe(1.12);
  });

  it("afasta do zero nos negativos", () => {
    expect(arredondarMoeda(-1.005)).toBe(-1.01);
    expect(arredondarMoeda(-0.004)).toBe(0);
  });

  it("mantém o que já tem duas casas e trata inteiros e texto", () => {
    expect(arredondarMoeda(100)).toBe(100);
    expect(arredondarMoeda(12.35)).toBe(12.35);
    expect(arredondarMoeda("12,345")).toBe(12.35);
    expect(arredondarMoeda("0.004")).toBe(0);
  });

  it("não quebra com valores inválidos ou notação científica", () => {
    expect(arredondarMoeda(Number.NaN)).toBe(0);
    expect(arredondarMoeda("abc")).toBe(0);
    expect(arredondarMoeda(1e-7)).toBe(0);
  });
});

describe("lerMoeda", () => {
  it("lê formatos brasileiros e internacionais", () => {
    expect(lerMoeda("1.234,56")).toBe(1234.56);
    expect(lerMoeda("R$ 100,00")).toBe(100);
    expect(lerMoeda("12.5")).toBe(12.5);
  });

  it("devolve null quando não é número", () => {
    expect(lerMoeda("")).toBeNull();
    expect(lerMoeda("abc")).toBeNull();
  });

  it('lê milhar brasileiro sem vírgula ("1.000" é mil, não R$1,00) — achado no code review', () => {
    expect(lerMoeda("1.000")).toBe(1000);
    expect(lerMoeda("12.345")).toBe(12345);
    expect(lerMoeda("1.234.567")).toBe(1234567);
  });

  it("mantém o ponto como decimal quando não é um grupo de milhar válido", () => {
    expect(lerMoeda("12.5")).toBe(12.5);
    expect(lerMoeda("12.50")).toBe(12.5);
  });
});
