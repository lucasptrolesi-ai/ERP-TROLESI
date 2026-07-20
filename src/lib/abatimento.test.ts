import { describe, expect, it } from "vitest";
import {
  abatimentoPermitido,
  avaliarPecaParaAbatimento,
  baseElegivelAbatimento,
  limiteAbatimento,
  valorAbatimentoValido,
} from "./abatimento";

describe("baseElegivelAbatimento / abatimentoPermitido", () => {
  it("compra abaixo de R$800 na base elegível bloqueia abatimento", () => {
    const base = baseElegivelAbatimento([{ valor: 799.99, elegivel: true }]);
    expect(abatimentoPermitido(base)).toBe(false);
  });
  it("compra de R$800 exatos libera abatimento", () => {
    const base = baseElegivelAbatimento([{ valor: 800, elegivel: true }]);
    expect(abatimentoPermitido(base)).toBe(true);
  });
  it("fornitura/embalagem (não elegível) não conta pra base mínima", () => {
    const base = baseElegivelAbatimento([
      { valor: 500, elegivel: true },
      { valor: 400, elegivel: false },
    ]);
    expect(base).toBe(500);
    expect(abatimentoPermitido(base)).toBe(false);
  });
});

describe("limiteAbatimento / valorAbatimentoValido — teto de 20%", () => {
  it("limite é 20% da base elegível", () => {
    expect(limiteAbatimento(1000)).toBe(200);
  });
  it("valor dentro do limite é válido", () => {
    expect(valorAbatimentoValido(200, 1000)).toBe(true);
  });
  it("valor acima do limite é rejeitado", () => {
    expect(valorAbatimentoValido(200.01, 1000)).toBe(false);
  });
});

describe("avaliarPecaParaAbatimento — inelegibilidades da seção 11", () => {
  const pecaOk = {
    material: "ouro 18k",
    danificada: false,
    marcaPresente: true,
    temPedra: false,
    temPerola: false,
    ehFitaOuFio: false,
    ultimaColecao: false,
    ehRelogio: false,
  };

  it("peça válida é elegível", () => {
    expect(avaliarPecaParaAbatimento(pecaOk).elegivel).toBe(true);
  });
  it("peça danificada é rejeitada", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, danificada: true }).elegivel).toBe(false);
  });
  it("peça sem marca é rejeitada", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, marcaPresente: false }).elegivel).toBe(false);
  });
  it("relógio é rejeitado", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, ehRelogio: true }).elegivel).toBe(false);
  });
  it("peça com pedra é rejeitada", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, temPedra: true }).elegivel).toBe(false);
  });
  it("peça com pérola é rejeitada", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, temPerola: true }).elegivel).toBe(false);
  });
  it("corrente de fita ou fio é rejeitada", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, ehFitaOuFio: true }).elegivel).toBe(false);
  });
  it("peça da última coleção é rejeitada", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, ultimaColecao: true }).elegivel).toBe(false);
  });
  it("folheado a prata é rejeitado", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, material: "Folheado a Prata" }).elegivel).toBe(false);
  });
  it("aço cirúrgico é rejeitado", () => {
    expect(avaliarPecaParaAbatimento({ ...pecaOk, material: "Aço cirúrgico" }).elegivel).toBe(false);
  });
});
