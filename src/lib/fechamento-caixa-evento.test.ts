import { describe, expect, it } from "vitest";
import { calcularResumoFechamentoCaixa } from "./fechamento-caixa-evento";

describe("calcularResumoFechamentoCaixa", () => {
  it("soma vendas por forma de pagamento", () => {
    const resumo = calcularResumoFechamentoCaixa(
      [
        { forma_pagamento: "dinheiro", total: 100, valor_desconto: 0 },
        { forma_pagamento: "dinheiro", total: 50, valor_desconto: 10 },
        { forma_pagamento: "pix", total: 200, valor_desconto: 0 },
        { forma_pagamento: "cartao_vista", total: 80, valor_desconto: 0 },
        { forma_pagamento: "cartao_parcelado", total: 300, valor_desconto: 0 },
      ],
      [],
      0,
    );

    expect(resumo.porFormaPagamento.dinheiro).toBe(150);
    expect(resumo.porFormaPagamento.pix).toBe(200);
    expect(resumo.porFormaPagamento.cartao_vista).toBe(80);
    expect(resumo.porFormaPagamento.cartao_parcelado).toBe(300);
    expect(resumo.totalVendido).toBe(730);
    expect(resumo.totalDescontos).toBe(10);
  });

  it("saldo em dinheiro soma abertura + vendas em dinheiro + entradas − retiradas", () => {
    const resumo = calcularResumoFechamentoCaixa(
      [
        { forma_pagamento: "dinheiro", total: 500, valor_desconto: 0 },
        { forma_pagamento: "pix", total: 300, valor_desconto: 0 },
      ],
      [
        { tipo: "retirada", valor: 100 },
        { tipo: "retirada", valor: 50 },
        { tipo: "entrada", valor: 40 },
      ],
      200,
    );

    expect(resumo.totalEntradas).toBe(40);
    expect(resumo.totalRetiradas).toBe(150);
    // 200 (abertura) + 500 (dinheiro vendido) + 40 (entrada) - 150 (retiradas) = 590
    expect(resumo.saldoDinheiro).toBe(590);
    expect(resumo.porFormaPagamento.pix).toBe(300);
  });

  it("sem vendas, movimentos ou abertura, tudo fica zerado", () => {
    const resumo = calcularResumoFechamentoCaixa([], [], 0);
    expect(resumo.totalVendido).toBe(0);
    expect(resumo.saldoDinheiro).toBe(0);
  });
});
