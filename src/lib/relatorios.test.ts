import { describe, expect, it } from "vitest";
import { pontosDoPedido, pontosTotal, quebraPorCliente, quebraPorVendedor } from "@/lib/relatorios";

type PedidoFixture = {
  status: string;
  total: number;
  cliente_id: string | null;
  clientes: { nome: string } | null;
  vendedor_id: string | null;
  pedido_itens: { codigo_peca: number | null; quantidade: number }[];
};

function pedido(overrides: Partial<PedidoFixture> = {}): PedidoFixture {
  return {
    status: "faturado",
    total: 100,
    cliente_id: "cliente-1",
    clientes: { nome: "Cliente 1" },
    vendedor_id: "vendedor-1",
    pedido_itens: [{ codigo_peca: 10, quantidade: 2 }],
    ...overrides,
  };
}

describe("pontosDoPedido / pontosTotal", () => {
  it("soma código da peça × quantidade de todos os itens", () => {
    const p = pedido({ pedido_itens: [{ codigo_peca: 10, quantidade: 2 }, { codigo_peca: 5, quantidade: 3 }] });
    expect(pontosDoPedido(p)).toBe(35);
  });

  it("trata codigo_peca nulo como zero, sem derrubar a conta", () => {
    expect(pontosDoPedido(pedido({ pedido_itens: [{ codigo_peca: null, quantidade: 4 }] }))).toBe(0);
  });

  it("pontosTotal ignora pedidos não faturados", () => {
    const pedidos = [pedido({ status: "faturado" }), pedido({ status: "cancelado" })];
    expect(pontosTotal(pedidos)).toBe(20);
  });
});

describe("quebraPorCliente", () => {
  it("agrupa faturamento, pontos e contagem de vendas por cliente", () => {
    const pedidos = [
      pedido({ cliente_id: "c1", clientes: { nome: "Ana" }, total: 100 }),
      pedido({ cliente_id: "c1", clientes: { nome: "Ana" }, total: 50, pedido_itens: [{ codigo_peca: 4, quantidade: 1 }] }),
      pedido({ cliente_id: "c2", clientes: { nome: "Beto" }, total: 200 }),
    ];
    const resultado = quebraPorCliente(pedidos);
    expect(resultado).toEqual([
      { id: "c2", nome: "Beto", vendas: 1, faturamento: 200, pontos: 20 },
      { id: "c1", nome: "Ana", vendas: 2, faturamento: 150, pontos: 24 },
    ]);
  });

  it("ignora pedidos não faturados e sem cliente", () => {
    const pedidos = [
      pedido({ status: "cancelado" }),
      pedido({ cliente_id: null, clientes: null }),
    ];
    expect(quebraPorCliente(pedidos)).toEqual([]);
  });
});

describe("quebraPorVendedor", () => {
  it("agrupa por vendedor usando o mapa de nomes", () => {
    const pedidos = [
      pedido({ vendedor_id: "v1", total: 300 }),
      pedido({ vendedor_id: "v2", total: 100, pedido_itens: [{ codigo_peca: 1, quantidade: 1 }] }),
    ];
    const nomes = new Map([["v1", "Carla"], ["v2", "Diego"]]);
    expect(quebraPorVendedor(pedidos, nomes)).toEqual([
      { id: "v1", nome: "Carla", vendas: 1, faturamento: 300, pontos: 20 },
      { id: "v2", nome: "Diego", vendas: 1, faturamento: 100, pontos: 1 },
    ]);
  });

  it("mostra — quando o vendedor não está no mapa (ex: usuário removido)", () => {
    const pedidos = [pedido({ vendedor_id: "v-removido", total: 10 })];
    expect(quebraPorVendedor(pedidos, new Map())[0].nome).toBe("—");
  });
});
