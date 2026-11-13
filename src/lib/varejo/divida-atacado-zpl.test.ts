import { describe, expect, it } from "vitest";
import { gerarZplNotinhaDivida } from "@/lib/varejo/divida-atacado-zpl";
import { formatarMoeda } from "@/lib/formatar-moeda";
import type { ItemComCodigoAtacado } from "@/lib/relatorios-varejo";

function item(overrides: Partial<ItemComCodigoAtacado> = {}): ItemComCodigoAtacado {
  return { id: "d1", produto_nome: "Brinco folheado", codigo_atacado: 4.4, quantidade: 1, custo_total: 9.86, venda_id: "v1", ...overrides };
}

describe("gerarZplNotinhaDivida", () => {
  it("começa com ^XA e termina com ^XZ, e usa bobina contínua (^MNN)", () => {
    const zpl = gerarZplNotinhaDivida([item()], 9.86, "13/11/2026");
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trim().endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("^MNN");
  });

  it("inclui o nome de cada peça e o total formatado", () => {
    const itens = [item({ produto_nome: "Brinco folheado" }), item({ id: "d2", produto_nome: "Anel folheado", venda_id: "v2" })];
    const zpl = gerarZplNotinhaDivida(itens, 19.72, "13/11/2026");
    expect(zpl).toContain("Brinco folheado");
    expect(zpl).toContain("Anel folheado");
    expect(zpl).toContain(formatarMoeda(19.72));
  });

  it("trunca nome de peça muito comprido em vez de invadir o resto da linha", () => {
    const zpl = gerarZplNotinhaDivida([item({ produto_nome: "Conjunto folheado todo trabalhado em filigrana dourada" })], 9.86, "13/11/2026");
    expect(zpl).not.toContain("Conjunto folheado todo trabalhado em filigrana dourada");
    expect(zpl).toContain("Conjunto folheado.");
  });

  it("cresce a altura do label (^LL) conforme o número de itens aumenta", () => {
    const alturaPoucosItens = Number(gerarZplNotinhaDivida([item()], 9.86, "13/11/2026").match(/\^LL(\d+)/)?.[1]);
    const muitosItens = Array.from({ length: 20 }, (_, i) => item({ id: `d${i}`, venda_id: `v${i}` }));
    const alturaMuitosItens = Number(gerarZplNotinhaDivida(muitosItens, 100, "13/11/2026").match(/\^LL(\d+)/)?.[1]);
    expect(alturaMuitosItens).toBeGreaterThan(alturaPoucosItens);
  });

  it("não quebra com lista vazia (ainda assim emite ZPL válido com cabeçalho/total)", () => {
    const zpl = gerarZplNotinhaDivida([], 0, "13/11/2026");
    expect(zpl).toContain("^XA");
    expect(zpl).toContain("^XZ");
    expect(zpl).toContain(formatarMoeda(0));
  });
});
