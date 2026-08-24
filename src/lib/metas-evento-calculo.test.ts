import { describe, expect, it } from "vitest";
import {
  diaEventoDe,
  estaNoPeriodoDoEvento,
  lucroProjetado,
  metaAcumuladaAte,
  metaDoDia,
  numeroDeVendas,
  pecasPorVenda,
  pecasVendidas,
  percentualAtingimento,
  realizado,
  realizadoAcumulado,
  realizadoDoDia,
  semaforo,
  ticketMedio,
  vendasDoDia,
  vendasDoEvento,
  vendasNecessarias,
  vendasPorPessoa,
} from "./metas-evento-calculo";
import { DIAS_EVENTO } from "./metas-evento";
import type { VendaEvento } from "./types";

function venda(parcial: Partial<VendaEvento> & { total: number; criado_em: string }): VendaEvento {
  return {
    id: crypto.randomUUID(),
    numero: 1,
    forma_pagamento: "dinheiro",
    numero_parcelas: 1,
    subtotal: parcial.total,
    valor_desconto: 0,
    status: "faturado",
    cliente_nome: null,
    cliente_cpf: null,
    cliente_telefone: null,
    vendas_evento_itens: [{ nome: "Peça", quantidade: 1, preco_unitario: parcial.total }],
    ...parcial,
  };
}

const [quinta, sexta, sabado, domingo] = DIAS_EVENTO;

describe("metaDoDia", () => {
  it("meta de cada dia bate com a tabela da spec", () => {
    expect(metaDoDia(quinta)).toBe(8700);
    expect(metaDoDia(sexta)).toBe(11600);
    expect(metaDoDia(sabado)).toBe(20300);
    expect(metaDoDia(domingo)).toBe(17400);
  });
});

describe("metaAcumuladaAte", () => {
  it("acumula na ordem dos dias, batendo com a coluna 'Acumulado' da spec", () => {
    expect(metaAcumuladaAte(quinta)).toBe(8700);
    expect(metaAcumuladaAte(sexta)).toBe(20300);
    expect(metaAcumuladaAte(sabado)).toBe(40600);
    expect(metaAcumuladaAte(domingo)).toBe(58000);
  });
});

describe("vendasNecessarias / vendasPorPessoa", () => {
  it("bate com a coluna 'Vendas (t. R$170)' e 'Por pessoa' da spec", () => {
    expect(vendasNecessarias(metaDoDia(quinta))).toBe(51);
    expect(vendasPorPessoa(vendasNecessarias(metaDoDia(quinta)))).toBe(26);
    expect(vendasNecessarias(metaDoDia(sabado))).toBe(119);
    expect(vendasPorPessoa(vendasNecessarias(metaDoDia(sabado)))).toBe(60);
  });
});

describe("diaEventoDe / estaNoPeriodoDoEvento", () => {
  it("acha o dia certo dentro do período", () => {
    expect(diaEventoDe("2026-09-05")?.dia).toBe("Sábado");
    expect(estaNoPeriodoDoEvento("2026-09-05")).toBe(true);
  });
  it("fora do período (spec §6: mostra consolidado em vez do bloco 'Hoje')", () => {
    expect(diaEventoDe("2026-09-10")).toBeNull();
    expect(estaNoPeriodoDoEvento("2026-09-10")).toBe(false);
    expect(estaNoPeriodoDoEvento("2026-09-02")).toBe(false);
  });
});

describe("vendasDoDia — agrupamento por fuso local (America/Sao_Paulo)", () => {
  const vendas = [
    venda({ total: 100, criado_em: "2026-09-03T15:00:00Z" }), // 12h em SP, dia 3
    venda({ total: 200, criado_em: "2026-09-04T02:30:00Z" }), // 23h30 do dia 3 em SP — ainda dia 3
    venda({ total: 300, criado_em: "2026-09-04T15:00:00Z" }), // dia 4
  ];

  it("separa corretamente mesmo perto da virada de fuso", () => {
    expect(vendasDoDia(vendas, "2026-09-03")).toHaveLength(2);
    expect(vendasDoDia(vendas, "2026-09-04")).toHaveLength(1);
  });

  it("realizadoDoDia soma só o dia pedido", () => {
    expect(realizadoDoDia(vendas, "2026-09-03")).toBe(300);
    expect(realizadoDoDia(vendas, "2026-09-04")).toBe(300);
  });
});

describe("realizado / realizadoAcumulado / vendasDoEvento", () => {
  const vendas = [
    venda({ total: 100, criado_em: "2026-09-03T15:00:00Z" }),
    venda({ total: 200, criado_em: "2026-09-06T15:00:00Z" }),
    venda({ total: 9999, criado_em: "2026-09-15T15:00:00Z" }), // fora do período, não conta
  ];

  it("realizado soma tudo o que recebeu", () => {
    expect(realizado(vendas)).toBe(10299);
  });

  it("realizadoAcumulado ignora vendas fora do período do evento", () => {
    expect(vendasDoEvento(vendas)).toHaveLength(2);
    expect(realizadoAcumulado(vendas)).toBe(300);
  });
});

describe("numeroDeVendas / pecasVendidas / ticketMedio / pecasPorVenda", () => {
  const vendas = [
    venda({
      total: 300,
      criado_em: "2026-09-03T15:00:00Z",
      vendas_evento_itens: [
        { nome: "Anel", quantidade: 2, preco_unitario: 100 },
        { nome: "Colar", quantidade: 1, preco_unitario: 100 },
      ],
    }),
    venda({ total: 100, criado_em: "2026-09-03T16:00:00Z", vendas_evento_itens: [{ nome: "Brinco", quantidade: 1, preco_unitario: 100 }] }),
  ];

  it("conta vendas e peças", () => {
    expect(numeroDeVendas(vendas)).toBe(2);
    expect(pecasVendidas(vendas)).toBe(4);
  });

  it("ticket médio é por venda, não por peça", () => {
    expect(ticketMedio(vendas)).toBe(200); // 400 / 2 vendas
  });

  it("peças por venda", () => {
    expect(pecasPorVenda(vendas)).toBe(2); // 4 peças / 2 vendas
  });

  it("sem vendas, tudo zero (sem divisão por zero)", () => {
    expect(ticketMedio([])).toBe(0);
    expect(pecasPorVenda([])).toBe(0);
  });
});

describe("lucroProjetado", () => {
  it("negativo antes do ponto de equilíbrio (19.200)", () => {
    expect(lucroProjetado(10000)).toBeLessThan(0);
  });
  it("zero exatamente no ponto de equilíbrio", () => {
    expect(lucroProjetado(19200)).toBeCloseTo(0, 6);
  });
  it("positivo acima do ponto de equilíbrio", () => {
    expect(lucroProjetado(58000)).toBeCloseTo(32333.33, 2); // meta batida = lucro > 30k alvo
  });
});

describe("percentualAtingimento / semaforo", () => {
  it("percentual simples", () => {
    expect(percentualAtingimento(5000, 10000)).toBe(0.5);
    expect(percentualAtingimento(100, 0)).toBe(0); // meta zero não divide por zero
  });
  it("semáforo vermelho abaixo de 70%", () => {
    expect(semaforo(0.5)).toBe("vermelho");
    expect(semaforo(0.699)).toBe("vermelho");
  });
  it("semáforo âmbar entre 70% e 99%", () => {
    expect(semaforo(0.7)).toBe("ambar");
    expect(semaforo(0.99)).toBe("ambar");
  });
  it("semáforo verde a partir de 100%", () => {
    expect(semaforo(1)).toBe("verde");
    expect(semaforo(1.3)).toBe("verde");
  });
});
