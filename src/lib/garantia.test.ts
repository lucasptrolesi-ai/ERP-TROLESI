import { describe, expect, it } from "vitest";
import { avaliarGarantiaFolheado, ehGarantiaSoDeAutenticidade } from "./garantia";

describe("avaliarGarantiaFolheado — seção 12", () => {
  const base = { percentualDescascamento: 85, marcaPresente: true, pecaCompleta: true, alianca: false };

  it("aprova quando descascamento ≥ 80%, marca presente, peça completa, não é aliança", () => {
    expect(avaliarGarantiaFolheado(base).aprovado).toBe(true);
  });
  it("reprova descascamento abaixo de 80%", () => {
    expect(avaliarGarantiaFolheado({ ...base, percentualDescascamento: 79.9 }).aprovado).toBe(false);
  });
  it("aliança folheada nunca é aprovada, mesmo com descascamento alto", () => {
    expect(avaliarGarantiaFolheado({ ...base, alianca: true, percentualDescascamento: 100 }).aprovado).toBe(false);
  });
  it("reprova sem marca presente", () => {
    expect(avaliarGarantiaFolheado({ ...base, marcaPresente: false }).aprovado).toBe(false);
  });
});

describe("ehGarantiaSoDeAutenticidade — seção 13", () => {
  it("prata/aço é classificada como autenticidade, nunca garantia integral", () => {
    expect(ehGarantiaSoDeAutenticidade("autenticidade_prata_aco")).toBe(true);
  });
  it("folheado a ouro e Orient não são garantia de autenticidade", () => {
    expect(ehGarantiaSoDeAutenticidade("folheado_ouro")).toBe(false);
    expect(ehGarantiaSoDeAutenticidade("orient")).toBe(false);
  });
});
