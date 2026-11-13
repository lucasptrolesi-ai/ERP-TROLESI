import { describe, expect, it } from "vitest";
import { construirPdfSimples, formatarColunasPdf, type LinhaPdf } from "@/lib/pdf-simples";

describe("construirPdfSimples", () => {
  it("gera um buffer que começa com o cabeçalho %PDF e termina em %%EOF", () => {
    const pdf = construirPdfSimples([{ texto: "ola mundo" }], 40);
    const texto = pdf.toString("latin1");
    expect(texto.startsWith("%PDF-1.4")).toBe(true);
    expect(texto.trim().endsWith("%%EOF")).toBe(true);
  });

  it("inclui o texto das linhas no stream de conteúdo", () => {
    const pdf = construirPdfSimples([{ texto: "Dividendo com o Atacado" }, { texto: "Total: R$ 9,86" }], 40);
    const texto = pdf.toString("latin1");
    expect(texto).toContain("Dividendo com o Atacado");
    expect(texto).toContain("Total: R$ 9,86");
  });

  it("escapa parênteses e barra invertida dentro do texto (sintaxe de string do PDF)", () => {
    const pdf = construirPdfSimples([{ texto: "valor (R$) \\ ok" }], 40);
    const texto = pdf.toString("latin1");
    expect(texto).toContain("valor \\(R$\\) \\\\ ok");
  });

  it("quebra em mais de uma página quando as linhas não cabem numa só", () => {
    const muitasLinhas: LinhaPdf[] = Array.from({ length: 80 }, (_, i) => ({ texto: `linha ${i}` }));
    const pdf = construirPdfSimples(muitasLinhas, 40);
    const texto = pdf.toString("latin1");
    expect(texto).toContain("/Count 2");
  });

  it("não quebra com lista vazia", () => {
    const pdf = construirPdfSimples([], 40);
    const texto = pdf.toString("latin1");
    expect(texto.startsWith("%PDF-1.4")).toBe(true);
  });
});

describe("formatarColunasPdf", () => {
  it("preenche com espaços até a largura total quando cabe", () => {
    const resultado = formatarColunasPdf("Peca", "R$ 9,86", 20);
    expect(resultado).toBe(`Peca${" ".repeat(9)}R$ 9,86`);
    expect(resultado.length).toBe(20);
  });

  it("trunca o texto da esquerda quando não cabe", () => {
    const resultado = formatarColunasPdf("Peca com nome bem comprido demais", "R$ 9,86", 20);
    expect(resultado.length).toBeLessThanOrEqual(20 + 1); // +1 do espaço separador garantido
    expect(resultado.endsWith("R$ 9,86")).toBe(true);
  });
});
