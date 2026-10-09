import { describe, expect, it } from "vitest";
import {
  calcularCusto,
  calcularMarkupMinimo,
  calcularMes,
  calcularPisoDePrejuizo,
  calcularPrecoMinimo,
  calcularPrecoSugerido,
  custoEquipeNoMes,
  faturamentoReferenciaProjetado,
  margemContribuicaoTeorica,
  mesclarFaturamentoDiario,
  recuperacaoDoInvestimento,
  saldoDeCaixa,
  valorNoMes,
  vigenteNoMes,
} from "@/lib/varejo/financeiro";

// Tabela de casos obrigatórios do documento do módulo (seção 10) — tolerância de R$ 0,01.

describe("precificação", () => {
  it("custo = código × fator de custo", () => {
    expect(calcularCusto(10, 2.8)).toBe(28);
  });

  it("preço sugerido arredonda pra ,90", () => {
    expect(calcularPrecoSugerido(10, 10.1, 19.9, true)).toBe(100.9);
  });

  it("preço sugerido no piso de entrada", () => {
    expect(calcularPrecoSugerido(2, 10.1, 19.9, true)).toBe(19.9);
  });

  it("preço sugerido abaixo do piso usa o piso", () => {
    expect(calcularPrecoSugerido(1, 10.1, 19.9, true)).toBe(19.9);
  });

  it("margem de contribuição teórica", () => {
    expect(margemContribuicaoTeorica(3.607, 0.1)).toBeCloseTo(0.6228, 4);
  });

  it("markup mínimo", () => {
    const r = calcularMarkupMinimo(0.1, 5100, 14000, 0.15);
    expect(r.viavel).toBe(true);
    if (r.viavel) expect(r.markup).toBeCloseTo(2.5926, 4);
  });

  it("markup mínimo inviável quando o denominador fica <= 0", () => {
    const r = calcularMarkupMinimo(0.1, 5100, 5000, 0.15);
    expect(r.viavel).toBe(false);
  });

  it("preço mínimo = custo × markup mínimo", () => {
    const markup = calcularMarkupMinimo(0.1, 5100, 14000, 0.15);
    expect(markup.viavel).toBe(true);
    if (markup.viavel) expect(calcularPrecoMinimo(28, markup.markup)).toBeCloseTo(72.59, 2);
  });

  it("piso de prejuízo = custo ÷ (1 - despesas variáveis)", () => {
    expect(calcularPisoDePrejuizo(28, 0.1)).toBeCloseTo(31.11, 2);
  });

  describe("faturamento de referência projetado (sem histórico de vendas ainda)", () => {
    // Bug real encontrado em produção (2026-10-09): usar a margem teórica inteira como faturamento
    // de referência fazia o markup mínimo pré-abertura EXPLODIR acima do markup padrão (preço
    // mínimo > preço sugerido, um paradoxo). Caso real: código 8,4, fator de venda 10,1 (markup
    // padrão ≈3,6071), despesas variáveis 10%, lucro desejado 15%, gastos fixos R$3.600/mês.
    it("sem desconto do lucro desejado no denominador, o markup mínimo passava do padrão (bug corrigido)", () => {
      const margemTeoricaCheia = margemContribuicaoTeorica(10.1 / 2.8, 0.1); // ≈0,6228, SEM descontar lucro
      const faturamentoErrado = 3600 / margemTeoricaCheia; // fórmula antiga, com bug
      const markupErrado = calcularMarkupMinimo(0.1, 3600, faturamentoErrado, 0.15);
      expect(markupErrado.viavel).toBe(true);
      if (markupErrado.viavel) expect(markupErrado.markup).toBeGreaterThan(10.1 / 2.8); // > markup padrão: o bug
    });

    it("descontando o lucro desejado, o markup mínimo converge pro markup padrão (preço mínimo = preço sugerido)", () => {
      const markupPadrao = 10.1 / 2.8;
      const faturamento = faturamentoReferenciaProjetado(3600, markupPadrao, 0.1, 0.15);
      expect(faturamento).not.toBeNull();
      const markup = calcularMarkupMinimo(0.1, 3600, faturamento!, 0.15);
      expect(markup.viavel).toBe(true);
      if (markup.viavel) expect(markup.markup).toBeCloseTo(markupPadrao, 4);
    });

    it("inviável (null) quando o lucro desejado sozinho já supera a margem teórica", () => {
      // markup padrão baixo + lucro desejado alto -> margem teórica - lucro fica <= 0.
      expect(faturamentoReferenciaProjetado(3600, 1.5, 0.1, 0.5)).toBeNull();
    });
  });

  it("despesas variáveis em 100% ou mais -- piso vira Infinity, não 0 silencioso", () => {
    expect(calcularPisoDePrejuizo(28, 1)).toBe(Infinity);
    expect(calcularPisoDePrejuizo(28, 1.2)).toBe(Infinity);
  });

  it("preço gravado nunca muda ao recalcular o sugerido com outro fator — a função nem recebe o preço atual como parâmetro", () => {
    const sugeridoAntigo = calcularPrecoSugerido(10, 10.1, 19.9, true);
    const sugeridoNovo = calcularPrecoSugerido(10, 11.2, 19.9, true);
    expect(sugeridoAntigo).not.toBe(sugeridoNovo);
    // calcularPrecoSugerido não tem como alterar um "preço gravado" — essa função não existe aqui;
    // só o Server Action que o dono aciona manualmente grava em catalogo_variacoes.preco_venda.
  });
});

describe("equipe e salários", () => {
  it("funcionária sem encargos: custo total é o próprio salário", () => {
    expect(custoEquipeNoMes([{ salario: 1900, somarEncargos: false, mesInicio: "2027-05-01", mesFim: null }], "2027-05-01", 0.34)).toBe(1900);
  });

  it("com encargos ligados, soma o percentual por cima", () => {
    expect(custoEquipeNoMes([{ salario: 1000, somarEncargos: true, mesInicio: "2027-05-01", mesFim: null }], "2027-05-01", 0.34)).toBe(1340);
  });
});

describe("lançamentos recorrentes", () => {
  it("compra parcelada divide igual nos meses das parcelas e some depois", () => {
    const compra = { tipo: "compra" as const, valor: 2400, mesInicio: "2027-01-01", parcelas: 4 };
    expect(valorNoMes(compra, "2027-01-01")).toBe(600);
    expect(valorNoMes(compra, "2027-02-01")).toBe(600);
    expect(valorNoMes(compra, "2027-03-01")).toBe(600);
    expect(valorNoMes(compra, "2027-04-01")).toBe(600);
    expect(valorNoMes(compra, "2027-05-01")).toBe(0);
  });

  it("gasto mensal com fim some depois do mês final", () => {
    const gasto = { tipo: "mensal" as const, valor: 300, mesInicio: "2026-11-01", mesFim: "2027-01-01" };
    expect(valorNoMes(gasto, "2026-11-01")).toBe(300);
    expect(valorNoMes(gasto, "2026-12-01")).toBe(300);
    expect(valorNoMes(gasto, "2027-01-01")).toBe(300);
    expect(valorNoMes(gasto, "2027-02-01")).toBe(0);
  });
});

describe("apuração mensal", () => {
  it("ponto de equilíbrio = (gastos + salários) / margem de contribuição", () => {
    const margem = margemContribuicaoTeorica(3.607, 0.1);
    const mes = calcularMes(
      {
        faturamento: 0,
        numeroVendas: 0,
        custoDasPecas: 0,
        despesasVariaveisPct: 0.1,
        margemTeoricaFallback: margem,
        gastosMensais: 5100,
        salarios: 0,
        movimentosCaixa: 0,
        compras: 0,
      },
      26,
    );
    // Sem faturamento no mês, calcularMes usa a margem teórica passada pelo chamador (não uma conta
    // própria) -- por isso o ponto de equilíbrio sai certo mesmo com faturamento = 0.
    expect(mes.pontoDeEquilibrio).toBeCloseTo(8189.33, 1);
    expect(mes.gastosMensais).toBe(5100);
  });

  it("sem faturamento, a margem teórica considera o custo (markup) -- não só 1 menos despesas variáveis", () => {
    // Bug corrigido: o fallback antigo usava 1 - despesasVariaveisPct direto (ignorando o custo da
    // peça por completo), inflando a margem e subestimando o ponto de equilíbrio num mês sem venda.
    const margemComCusto = margemContribuicaoTeorica(3.607, 0.1); // ~0,6228
    const margemIngenuaAntiga = 1 - 0.1; // 0,90 -- o que o bug produzia
    expect(margemComCusto).toBeLessThan(margemIngenuaAntiga);
    const mes = calcularMes(
      {
        faturamento: 0,
        numeroVendas: 0,
        custoDasPecas: 0,
        despesasVariaveisPct: 0.1,
        margemTeoricaFallback: margemComCusto,
        gastosMensais: 5100,
        salarios: 0,
        movimentosCaixa: 0,
        compras: 0,
      },
      26,
    );
    expect(mes.margemContribuicaoPct).toBeCloseTo(margemComCusto, 6);
  });

  it("dia com venda no PDV ignora a venda manual do mesmo dia", () => {
    const resultado = mesclarFaturamentoDiario(
      [{ data: "2026-11-05", faturamento: 640.5, numeroVendas: 7 }],
      [{ data: "2026-11-05", faturamento: 999, numeroVendas: 1 }],
    );
    expect(resultado).toEqual([{ data: "2026-11-05", faturamento: 640.5, numeroVendas: 7 }]);
  });

  it("dia sem venda no PDV usa a venda manual normalmente", () => {
    const resultado = mesclarFaturamentoDiario([], [{ data: "2026-11-06", faturamento: 300, numeroVendas: 3 }]);
    expect(resultado).toEqual([{ data: "2026-11-06", faturamento: 300, numeroVendas: 3 }]);
  });
});

describe("vigência de config", () => {
  it("usa a vigência mais recente que não passa do mês pedido", () => {
    const linhas = [{ vigente_desde: "2026-11-01", v: "a" }, { vigente_desde: "2027-02-01", v: "b" }];
    expect(vigenteNoMes(linhas, "2027-01-01")?.v).toBe("a");
    expect(vigenteNoMes(linhas, "2027-02-01")?.v).toBe("b");
    expect(vigenteNoMes(linhas, "2026-10-01")).toBeNull();
  });
});

describe("caixa e investimento", () => {
  it("investimento inicial não reduz o caixa — a função nem aceita esse valor como parâmetro", () => {
    const saldoSemVendas = saldoDeCaixa(10000, 0, 0, 0);
    expect(saldoSemVendas).toBe(10000);
  });

  it("recuperação do investimento", () => {
    const r = recuperacaoDoInvestimento(10000, 1000 + 1500);
    expect(r.percentual).toBeCloseTo(0.25, 4);
    expect(r.falta).toBe(7500);
  });
});
