import { describe, expect, it } from "vitest";
import { maxParcelasSemJuros, type FaixaParcelamento } from "./parcelamento";

const FAIXAS_CARTAO: FaixaParcelamento[] = [
  { valorMinimo: 200, parcelasSemJuros: 2 },
  { valorMinimo: 300, parcelasSemJuros: 3 },
];

describe("maxParcelasSemJuros — limiares do documento mestre (seção 28)", () => {
  it("R$199,99 não libera 2x sem juros", () => {
    expect(maxParcelasSemJuros(199.99, FAIXAS_CARTAO)).toBe(1);
  });
  it("R$200,00 libera até 2x sem juros", () => {
    expect(maxParcelasSemJuros(200.0, FAIXAS_CARTAO)).toBe(2);
  });
  it("R$299,99 libera até 2x sem juros (não 3x)", () => {
    expect(maxParcelasSemJuros(299.99, FAIXAS_CARTAO)).toBe(2);
  });
  it("R$300,00 libera até 3x sem juros", () => {
    expect(maxParcelasSemJuros(300.0, FAIXAS_CARTAO)).toBe(3);
  });
  it("sem faixas configuradas, nunca libera parcelamento sem juros além de 1x", () => {
    expect(maxParcelasSemJuros(10000, [])).toBe(1);
  });
});
