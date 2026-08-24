// Camada de cálculo pura do painel de metas — nenhuma função aqui lê o
// relógio do sistema nem toca em rede/banco; tudo recebe os dados já
// carregados (mesmas vendas que a aba Resumo já usa) e a data "de hoje"
// como parâmetro, pra ficar testável sem mockar Date. Ver metas-evento.ts
// pras constantes/config.

import { dataLocalDoTimestamptz } from "@/lib/datas";
import { dentroDoPeriodo, pedidosNoPeriodo } from "@/lib/relatorios";
import { CUSTO_EVENTO, DIAS_EVENTO, MARGEM_BRUTA, META_TRABALHO, NUM_PESSOAS_STAND, PERIODO_EVENTO, TICKET_ALVO, type DiaEvento } from "@/lib/metas-evento";
import type { VendaEvento } from "@/lib/types";

export type Semaforo = "vermelho" | "ambar" | "verde";

export function metaDoDia(dia: DiaEvento): number {
  return dia.peso * META_TRABALHO;
}

/** Soma das metas do primeiro dia até `dia` (inclusive), na ordem em que
 * aparecem em DIAS_EVENTO. */
export function metaAcumuladaAte(dia: DiaEvento): number {
  const indice = DIAS_EVENTO.findIndex((d) => d.data === dia.data);
  if (indice === -1) return 0;
  return DIAS_EVENTO.slice(0, indice + 1).reduce((soma, d) => soma + metaDoDia(d), 0);
}

/** Nº de vendas (a R$170 cada) necessárias pra bater uma meta em reais. */
export function vendasNecessarias(metaEmReais: number): number {
  return Math.round(metaEmReais / TICKET_ALVO);
}

export function vendasPorPessoa(vendas: number): number {
  return Math.round(vendas / NUM_PESSOAS_STAND);
}

/** DiaEvento cuja `data` bate com `dataLocal` (formato AAAA-MM-DD) — null
 * fora do período do evento (spec §6: fora do período mostra o consolidado
 * final em vez do bloco "Hoje"). */
export function diaEventoDe(dataLocal: string): DiaEvento | null {
  return DIAS_EVENTO.find((d) => d.data === dataLocal) ?? null;
}

export function estaNoPeriodoDoEvento(dataLocal: string): boolean {
  return dentroDoPeriodo(dataLocal, PERIODO_EVENTO.inicio, PERIODO_EVENTO.fim);
}

/** Vendas cujo criado_em (convertido pro fuso local) cai exatamente em
 * `dataLocal`. */
export function vendasDoDia(vendas: VendaEvento[], dataLocal: string): VendaEvento[] {
  return vendas.filter((v) => dataLocalDoTimestamptz(v.criado_em) === dataLocal);
}

/** Vendas dentro do período inteiro do evento (03–06/09). */
export function vendasDoEvento(vendas: VendaEvento[]): VendaEvento[] {
  return pedidosNoPeriodo(vendas, PERIODO_EVENTO.inicio, PERIODO_EVENTO.fim);
}

/** Realizado (R$) — soma de `total`, que já é líquido de desconto
 * (subtotal − valor_desconto, calculado em criar_venda_evento). */
export function realizado(vendas: VendaEvento[]): number {
  return vendas.reduce((soma, v) => soma + v.total, 0);
}

export function realizadoDoDia(vendas: VendaEvento[], dataLocal: string): number {
  return realizado(vendasDoDia(vendas, dataLocal));
}

export function realizadoAcumulado(vendas: VendaEvento[]): number {
  return realizado(vendasDoEvento(vendas));
}

export function numeroDeVendas(vendas: VendaEvento[]): number {
  return vendas.length;
}

export function pecasVendidas(vendas: VendaEvento[]): number {
  return vendas.reduce((soma, v) => soma + v.vendas_evento_itens.reduce((s, i) => s + i.quantidade, 0), 0);
}

export function ticketMedio(vendas: VendaEvento[]): number {
  const n = numeroDeVendas(vendas);
  return n > 0 ? realizado(vendas) / n : 0;
}

export function pecasPorVenda(vendas: VendaEvento[]): number {
  const n = numeroDeVendas(vendas);
  return n > 0 ? pecasVendidas(vendas) / n : 0;
}

/** Lucro projetado a partir do realizado acumulado — (realizado × margem
 * bruta) − custo do evento. Negativo antes do ponto de equilíbrio. */
export function lucroProjetado(realizadoValor: number): number {
  return realizadoValor * MARGEM_BRUTA - CUSTO_EVENTO;
}

/** % de atingimento — não trava em 100%, uma meta batida em 130% devolve
 * 1.3 (a UI decide se quer exibir acima de 100%). */
export function percentualAtingimento(realizadoValor: number, meta: number): number {
  return meta > 0 ? realizadoValor / meta : 0;
}

/** Semáforo (spec §4.1): vermelho <70%, âmbar 70–99%, verde ≥100%. */
export function semaforo(percentual: number): Semaforo {
  if (percentual >= 1) return "verde";
  if (percentual >= 0.7) return "ambar";
  return "vermelho";
}
