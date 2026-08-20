import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataHoraIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import type { LinhaImpressao } from "@/lib/cupom-linhas";
import { FORMA_LABEL_EVENTO } from "@/lib/forma-pagamento-evento";
import type { FormaPagamentoEvento } from "@/lib/types";

export type VendaEventoParaCupom = {
  numero: number;
  criado_em: string;
  forma_pagamento: FormaPagamentoEvento;
  numero_parcelas: number;
  subtotal: number;
  valor_desconto: number;
  total: number;
  itens: { nome: string; quantidade: number; preco_unitario: number }[];
  cliente_nome: string | null;
  cliente_cpf: string | null;
  cliente_telefone: string | null;
};

// Mesmo formato de linhas do cupom do PDV real (cupom-linhas.ts) — reaproveita
// o print-agent local sem mudar nada nele. Venda de evento é anônima (sem
// cliente) e não tem pontos/parcelas planejadas, então essas linhas ficam de
// fora, diferente do cupom de pedido normal.
export function construirLinhasCupomEvento(
  venda: VendaEventoParaCupom,
  via: "loja" | "cliente",
): LinhaImpressao[] {
  const linhas: LinhaImpressao[] = [];

  linhas.push({ tipo: "texto", texto: via === "loja" ? "VIA LOJA" : "VIA CLIENTE", alinhamento: "centro", negrito: true });
  linhas.push({ tipo: "texto", texto: `${EMPRESA.nome} — AGROSHOW`, alinhamento: "centro", negrito: true });
  linhas.push({ tipo: "texto", texto: `CNPJ ${EMPRESA.cpfCnpj}`, alinhamento: "centro" });
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "texto", texto: `Venda evento #${venda.numero}` });
  linhas.push({ tipo: "texto", texto: formatarDataHoraIso(venda.criado_em) });
  linhas.push({ tipo: "linha" });

  // Cliente é opcional (venda de evento continua anônima por padrão) — só
  // entra na notinha o que foi preenchido.
  if (venda.cliente_nome || venda.cliente_cpf || venda.cliente_telefone) {
    if (venda.cliente_nome) linhas.push({ tipo: "texto", texto: `Cliente: ${venda.cliente_nome}` });
    if (venda.cliente_cpf) linhas.push({ tipo: "texto", texto: `CPF: ${venda.cliente_cpf}` });
    if (venda.cliente_telefone) linhas.push({ tipo: "texto", texto: `Tel: ${venda.cliente_telefone}` });
    linhas.push({ tipo: "linha" });
  }

  linhas.push({ tipo: "colunas", esquerda: "Qtd Peça", direita: "Preço", negrito: true });
  for (const item of venda.itens) {
    linhas.push({
      tipo: "colunas",
      esquerda: `${item.quantidade}x ${item.nome}`,
      direita: formatarMoeda(item.quantidade * item.preco_unitario),
    });
  }
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "colunas", esquerda: "Subtotal", direita: formatarMoeda(venda.subtotal) });
  if (venda.valor_desconto > 0) {
    linhas.push({ tipo: "colunas", esquerda: "Desconto", direita: `- ${formatarMoeda(venda.valor_desconto)}` });
  }
  linhas.push({ tipo: "colunas", esquerda: "TOTAL", direita: formatarMoeda(venda.total), negrito: true });
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "texto", texto: `Pagamento: ${FORMA_LABEL_EVENTO[venda.forma_pagamento]}` });
  if (venda.forma_pagamento === "cartao_parcelado" && venda.numero_parcelas > 1) {
    linhas.push({ tipo: "texto", texto: `${venda.numero_parcelas}x de ${formatarMoeda(venda.total / venda.numero_parcelas)}` });
  }

  linhas.push({ tipo: "linha" });
  linhas.push({ tipo: "texto", texto: "Obrigado pela preferencia!", alinhamento: "centro" });
  linhas.push({ tipo: "texto", texto: "Documento nao fiscal", alinhamento: "centro" });

  return linhas;
}
