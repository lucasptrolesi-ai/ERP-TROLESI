/** Regras de abatimento de peças (seção 11 do documento mestre). Compra
 * mínima R$800 na base elegível; limite máximo de abatimento é 20% dessa
 * mesma base. */

export type ItemParaBaseAbatimento = { valor: number; elegivel: boolean };

/** Fornitura, embalagem e produtos de condicional não entram na base
 * mínima/elegível do abatimento — mesma lógica de elegibilidade já usada
 * no desconto automático (produto.eh_fornitura/eh_embalagem). */
export function baseElegivelAbatimento(itens: ItemParaBaseAbatimento[]): number {
  return itens.filter((item) => item.elegivel).reduce((soma, item) => soma + item.valor, 0);
}

export function abatimentoPermitido(baseElegivel: number): boolean {
  return baseElegivel >= 800;
}

export function limiteAbatimento(baseElegivel: number): number {
  return Math.round(baseElegivel * 0.2 * 100) / 100;
}

export function valorAbatimentoValido(valorAtribuido: number, baseElegivel: number): boolean {
  return valorAtribuido >= 0 && valorAtribuido <= limiteAbatimento(baseElegivel);
}

export type PecaAbatimento = {
  material: string | null;
  danificada: boolean;
  marcaPresente: boolean;
  temPedra: boolean;
  temPerola: boolean;
  ehFitaOuFio: boolean;
  ultimaColecao: boolean;
  ehRelogio: boolean;
};

export type AvaliacaoPeca = { elegivel: boolean; motivo?: string };

/** Peças aceitas/rejeitadas pra abatimento (seção 11) — folheados a prata,
 * aço, peças danificadas/quebradas/arranhadas/incompletas/sem marca,
 * embalagens, relógios, peças com pérola ou pedra, correntes de fita ou
 * fio, peças da última coleção nunca são aceitas. */
export function avaliarPecaParaAbatimento(peca: PecaAbatimento): AvaliacaoPeca {
  if (peca.danificada) return { elegivel: false, motivo: "Peça danificada, quebrada, arranhada ou incompleta." };
  if (!peca.marcaPresente) return { elegivel: false, motivo: "Peça sem marca." };
  if (peca.ehRelogio) return { elegivel: false, motivo: "Relógios não são aceitos em abatimento." };
  if (peca.temPedra) return { elegivel: false, motivo: "Peças com pedra não são aceitas." };
  if (peca.temPerola) return { elegivel: false, motivo: "Peças com pérola não são aceitas." };
  if (peca.ehFitaOuFio) return { elegivel: false, motivo: "Correntes de fita ou fio não são aceitas." };
  if (peca.ultimaColecao) return { elegivel: false, motivo: "Peças da última coleção não são aceitas." };

  const material = (peca.material ?? "").toLowerCase();
  if (material.includes("folheado a prata") || material.includes("aço") || material.includes("aco")) {
    return { elegivel: false, motivo: "Folheados a prata e aço cirúrgico não são aceitos." };
  }

  return { elegivel: true };
}
