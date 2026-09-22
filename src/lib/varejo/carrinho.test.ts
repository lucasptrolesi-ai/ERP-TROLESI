import { describe, expect, it } from "vitest";
import { calcularLinha, calcularTotais, calcularTroco } from "@/lib/varejo/carrinho";
import type { ItemCatalogo } from "@/lib/varejo/tipos";

function item(overrides: Partial<ItemCatalogo> = {}): ItemCatalogo {
  return {
    variacao_id: "v1",
    produto_id: "p1",
    nome: "Anel solitário",
    categoria: "Anéis",
    sku: "SKU-1",
    codigo_barras: null,
    atributos: {},
    preco_venda: 100,
    preco_minimo: 80,
    saldo: 10,
    ...overrides,
  };
}

describe("calcularLinha", () => {
  it("usa o preço de tabela quando o campo está vazio", () => {
    const linha = calcularLinha({ variacao: item(), quantidade: 2, precoTexto: "" });
    expect(linha.preco).toBe(100);
    expect(linha.abaixoDoPiso).toBe(false);
  });

  it("nunca deixa o preço passar do de tabela — o cliente só pede desconto, nunca acréscimo", () => {
    const linha = calcularLinha({ variacao: item(), quantidade: 1, precoTexto: "500,00" });
    expect(linha.preco).toBe(100);
  });

  it("marca abaixo do piso quando o preço digitado é menor que preco_minimo", () => {
    const linha = calcularLinha({ variacao: item(), quantidade: 1, precoTexto: "79,90" });
    expect(linha.preco).toBe(79.9);
    expect(linha.abaixoDoPiso).toBe(true);
  });

  it("no preço exato do piso não exige autorização", () => {
    const linha = calcularLinha({ variacao: item(), quantidade: 1, precoTexto: "80,00" });
    expect(linha.abaixoDoPiso).toBe(false);
  });

  it("sem preco_minimo cadastrado, o próprio preço de tabela é o piso (qualquer desconto exige PIN)", () => {
    const linha = calcularLinha({ variacao: item({ preco_minimo: null }), quantidade: 1, precoTexto: "99,99" });
    expect(linha.abaixoDoPiso).toBe(true);
  });
});

describe("calcularTotais", () => {
  it("soma subtotal pelo preço de tabela e total pelo preço praticado, e sinaliza autorização", () => {
    const linhas = [
      calcularLinha({ variacao: item({ variacao_id: "a", preco_venda: 100, preco_minimo: 80 }), quantidade: 2, precoTexto: "" }),
      calcularLinha({ variacao: item({ variacao_id: "b", preco_venda: 50, preco_minimo: 45 }), quantidade: 1, precoTexto: "40,00" }),
    ];
    const totais = calcularTotais(linhas);
    expect(totais.subtotal).toBe(250);
    expect(totais.total).toBe(240);
    expect(totais.precisaAutorizacao).toBe(true);
  });

  it("carrinho vazio dá zero em tudo, sem exigir autorização", () => {
    expect(calcularTotais([])).toEqual({ subtotal: 0, total: 0, precisaAutorizacao: false });
  });
});

describe("calcularTroco", () => {
  it("calcula troco só em dinheiro", () => {
    expect(calcularTroco("dinheiro", 300, 250)).toBe(50);
    expect(calcularTroco("pix", 300, 250)).toBe(0);
  });

  it("nunca é negativo", () => {
    expect(calcularTroco("dinheiro", 100, 250)).toBe(0);
  });
});
