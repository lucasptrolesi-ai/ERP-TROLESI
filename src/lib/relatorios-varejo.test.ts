import { describe, expect, it } from "vitest";
import {
  codigoAtacadoPorVenda,
  dividaAtacadoEmAberto,
  faturamentoVarejoTotal,
  movimentoVarejoDiario,
  quebraVarejoPorCliente,
  quebraVarejoPorFormaPagamento,
  quebraVarejoPorVendedor,
  vendasNoPeriodo,
  type DividaAtacadoRelatorio,
  type VendaRelatorio,
} from "@/lib/relatorios-varejo";

function venda(overrides: Partial<VendaRelatorio> = {}): VendaRelatorio {
  return {
    id: "v1",
    numero: 1,
    status: "concluida",
    total: 100,
    criada_em: "2026-11-03T15:00:00+00:00",
    cliente_id: "cliente-1",
    operador_id: "vendedor-1",
    clientes: { nome: "Cliente 1" },
    ...overrides,
  };
}

describe("faturamentoVarejoTotal", () => {
  it("soma só vendas concluídas, ignora canceladas", () => {
    const vendas = [venda({ status: "concluida", total: 100 }), venda({ status: "cancelada", total: 50 })];
    expect(faturamentoVarejoTotal(vendas)).toBe(100);
  });
});

describe("vendasNoPeriodo", () => {
  it("filtra pela data local (fuso de Brasília) de criada_em", () => {
    const vendas = [
      venda({ id: "dentro", criada_em: "2026-11-03T15:00:00+00:00" }),
      venda({ id: "fora", criada_em: "2026-10-01T15:00:00+00:00" }),
    ];
    const resultado = vendasNoPeriodo(vendas, "2026-11-01", "2026-11-30");
    expect(resultado.map((v) => v.id)).toEqual(["dentro"]);
  });
});

describe("movimentoVarejoDiario", () => {
  it("devolve um ponto por dia, zerado nos dias sem venda concluída", () => {
    const vendas = [venda({ criada_em: "2026-11-03T15:00:00+00:00", total: 100, status: "concluida" })];
    const resultado = movimentoVarejoDiario(vendas, "2026-11-02", "2026-11-04");
    expect(resultado).toEqual([
      { data: "2026-11-02", valor: 0 },
      { data: "2026-11-03", valor: 100 },
      { data: "2026-11-04", valor: 0 },
    ]);
  });
});

describe("quebraVarejoPorFormaPagamento", () => {
  it("soma valor por forma", () => {
    const resultado = quebraVarejoPorFormaPagamento([
      { forma: "pix", valor: 100 },
      { forma: "pix", valor: 50 },
      { forma: "dinheiro", valor: 30 },
    ]);
    expect(resultado).toEqual({ pix: 150, dinheiro: 30 });
  });
});

describe("quebraVarejoPorCliente", () => {
  it("agrupa faturamento e contagem de vendas por cliente, ignora canceladas e sem cliente", () => {
    const vendas = [
      venda({ cliente_id: "c1", clientes: { nome: "Ana" }, total: 100 }),
      venda({ cliente_id: "c1", clientes: { nome: "Ana" }, total: 50 }),
      venda({ cliente_id: "c2", clientes: { nome: "Beto" }, total: 200 }),
      venda({ status: "cancelada", cliente_id: "c1", clientes: { nome: "Ana" }, total: 999 }),
      venda({ cliente_id: null, clientes: null }),
    ];
    expect(quebraVarejoPorCliente(vendas)).toEqual([
      { id: "c2", nome: "Beto", vendas: 1, faturamento: 200, codigoAtacado: 0 },
      { id: "c1", nome: "Ana", vendas: 2, faturamento: 150, codigoAtacado: 0 },
    ]);
  });

  it("soma o código do Atacado (via mapa venda->código) dentro de cada grupo", () => {
    const vendas = [
      venda({ id: "v1", cliente_id: "c1", clientes: { nome: "Ana" }, total: 100 }),
      venda({ id: "v2", cliente_id: "c1", clientes: { nome: "Ana" }, total: 50 }),
    ];
    const codigoPorVenda = new Map([["v1", 20], ["v2", 5]]);
    expect(quebraVarejoPorCliente(vendas, codigoPorVenda)).toEqual([
      { id: "c1", nome: "Ana", vendas: 2, faturamento: 150, codigoAtacado: 25 },
    ]);
  });
});

describe("quebraVarejoPorVendedor", () => {
  it("agrupa por operador usando o mapa de nomes", () => {
    const vendas = [venda({ operador_id: "v1", total: 300 }), venda({ operador_id: "v2", total: 100 })];
    const nomes = new Map([["v1", "Carla"]]);
    expect(quebraVarejoPorVendedor(vendas, nomes)).toEqual([
      { id: "v1", nome: "Carla", vendas: 1, faturamento: 300, codigoAtacado: 0 },
      { id: "v2", nome: "—", vendas: 1, faturamento: 100, codigoAtacado: 0 },
    ]);
  });
});

describe("codigoAtacadoPorVenda", () => {
  function divida(overrides: Partial<DividaAtacadoRelatorio> = {}): DividaAtacadoRelatorio {
    return { codigo_atacado: 10, quantidade: 1, custo_total: 28, status: "em_aberto", venda_itens: { venda_id: "v1" }, ...overrides };
  }

  it("soma codigo_atacado × quantidade por venda, somando itens da mesma venda", () => {
    const dividas = [
      divida({ venda_itens: { venda_id: "v1" }, codigo_atacado: 10, quantidade: 2 }),
      divida({ venda_itens: { venda_id: "v1" }, codigo_atacado: 5, quantidade: 1 }),
      divida({ venda_itens: { venda_id: "v2" }, codigo_atacado: 3, quantidade: 4 }),
    ];
    const mapa = codigoAtacadoPorVenda(dividas);
    expect(mapa.get("v1")).toBe(25);
    expect(mapa.get("v2")).toBe(12);
  });

  it("ignora dívida sem venda_itens (origem compra, não venda)", () => {
    expect(codigoAtacadoPorVenda([divida({ venda_itens: null })]).size).toBe(0);
  });
});

describe("dividaAtacadoEmAberto", () => {
  it("soma custo_total só das dívidas em_aberto, ignora pagas", () => {
    const dividas = [
      { status: "em_aberto", custo_total: 100 },
      { status: "em_aberto", custo_total: 50 },
      { status: "pago", custo_total: 999 },
    ];
    expect(dividaAtacadoEmAberto(dividas)).toBe(150);
  });
});
