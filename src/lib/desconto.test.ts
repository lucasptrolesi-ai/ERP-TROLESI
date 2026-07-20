import { describe, expect, it } from "vitest";
import { calcularDescontoAutomatico, percentualDescontoAutomatico } from "./desconto";

describe("percentualDescontoAutomatico", () => {
  it("dinheiro à vista é 10%", () => {
    expect(percentualDescontoAutomatico("dinheiro")).toBe(0.1);
  });
  it("Pix é 7%", () => {
    expect(percentualDescontoAutomatico("pix")).toBe(0.07);
  });
  it("débito é 7%", () => {
    expect(percentualDescontoAutomatico("debito")).toBe(0.07);
  });
  it("cartão de crédito e promissória não têm desconto automático", () => {
    expect(percentualDescontoAutomatico("cartao_credito")).toBe(0);
    expect(percentualDescontoAutomatico("promissoria")).toBe(0);
  });
});

describe("calcularDescontoAutomatico", () => {
  it("caso de referência do documento mestre: R$1000 elegível + R$100 de fornitura, dinheiro → desconto R$100 (nunca R$110)", () => {
    const resultado = calcularDescontoAutomatico(
      [
        { valor: 1000, elegivel: true },
        { valor: 100, elegivel: false },
      ],
      "dinheiro",
    );
    expect(resultado.baseElegivel).toBe(1000);
    expect(resultado.valorDesconto).toBe(100);
    expect(resultado.totalFinal).toBe(1000);
  });

  it("fornitura nunca recebe desconto, mesmo sendo o único item elegível restante", () => {
    const resultado = calcularDescontoAutomatico([{ valor: 50, elegivel: false }], "dinheiro");
    expect(resultado.baseElegivel).toBe(0);
    expect(resultado.valorDesconto).toBe(0);
    expect(resultado.totalFinal).toBe(50);
  });

  it("cartão de crédito não aplica desconto automático nenhum", () => {
    const resultado = calcularDescontoAutomatico([{ valor: 500, elegivel: true }], "cartao_credito");
    expect(resultado.valorDesconto).toBe(0);
    expect(resultado.totalFinal).toBe(500);
  });
});
