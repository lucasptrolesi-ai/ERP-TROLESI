import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { formatarDataHoraIso, formatarDataIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import type { ContaReceber, Pedido } from "@/lib/types";

export type LinhaImpressao =
  | { tipo: "texto"; texto: string; alinhamento?: "esquerda" | "centro" | "direita"; negrito?: boolean }
  | { tipo: "colunas"; esquerda: string; direita: string; negrito?: boolean }
  | { tipo: "linha" }
  | { tipo: "espaco"; linhas?: number };

// Mesmo conteúdo do cupom em HTML (cupom-view.tsx), só que como uma lista de
// linhas estruturadas — o print-agent local (print-agent/agent.js) monta os
// comandos ESC/POS a partir disso, em vez do navegador rasterizar a página.
export function construirLinhasCupom(pedido: Pedido, parcelas: ContaReceber[], via: "loja" | "cliente"): LinhaImpressao[] {
  const linhas: LinhaImpressao[] = [];

  linhas.push({ tipo: "texto", texto: via === "loja" ? "VIA LOJA" : "VIA CLIENTE", alinhamento: "centro", negrito: true });
  linhas.push({ tipo: "texto", texto: EMPRESA.nome, alinhamento: "centro", negrito: true });
  linhas.push({ tipo: "texto", texto: `CNPJ ${EMPRESA.cpfCnpj}`, alinhamento: "centro" });
  linhas.push({ tipo: "texto", texto: `${EMPRESA.endereco.logradouro}, ${EMPRESA.endereco.numero}`, alinhamento: "centro" });
  linhas.push({ tipo: "texto", texto: EMPRESA.endereco.bairro, alinhamento: "centro" });
  linhas.push({ tipo: "texto", texto: `${EMPRESA.endereco.cidade}/${EMPRESA.endereco.uf}`, alinhamento: "centro" });
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "texto", texto: `Pedido #${pedido.numero}` });
  linhas.push({ tipo: "texto", texto: formatarDataHoraIso(pedido.criado_em) });
  linhas.push({ tipo: "texto", texto: `Cliente: ${pedido.clientes?.nome ?? "-"}` });
  linhas.push({ tipo: "linha" });

  for (const item of pedido.pedido_itens) {
    linhas.push({
      tipo: "colunas",
      esquerda: `${item.quantidade}x ${item.produtos?.nome ?? "Produto"}`,
      direita: formatarMoeda(item.quantidade * item.preco_unitario),
    });
  }
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "colunas", esquerda: "Subtotal", direita: formatarMoeda(pedido.subtotal) });
  if (pedido.valor_desconto > 0) {
    linhas.push({ tipo: "colunas", esquerda: "Desconto", direita: `- ${formatarMoeda(pedido.valor_desconto)}` });
  }
  if (pedido.valor_acrescimo > 0) {
    linhas.push({ tipo: "colunas", esquerda: "Acrescimo", direita: `+ ${formatarMoeda(pedido.valor_acrescimo)}` });
  }
  linhas.push({ tipo: "colunas", esquerda: "TOTAL", direita: formatarMoeda(pedido.total), negrito: true });
  linhas.push({ tipo: "linha" });

  linhas.push({
    tipo: "texto",
    texto: `Pagamento: ${pedido.forma_pagamento ? FORMA_LABEL[pedido.forma_pagamento] : "-"}`,
  });
  if (pedido.forma_pagamento === "misto") {
    for (const p of pedido.pedido_pagamentos_mistos) {
      linhas.push({ tipo: "colunas", esquerda: FORMA_LABEL[p.forma_pagamento], direita: formatarMoeda(p.valor) });
    }
  }
  for (const p of parcelas) {
    linhas.push({
      tipo: "texto",
      texto: `Parc. ${p.numero_parcela}/${p.total_parcelas} - vence ${formatarDataIso(p.vencimento)} - ${formatarMoeda(p.valor)}`,
    });
  }

  linhas.push({ tipo: "linha" });
  linhas.push({ tipo: "texto", texto: "Obrigado pela preferencia!", alinhamento: "centro" });
  linhas.push({ tipo: "texto", texto: "Documento nao fiscal", alinhamento: "centro" });

  return linhas;
}
