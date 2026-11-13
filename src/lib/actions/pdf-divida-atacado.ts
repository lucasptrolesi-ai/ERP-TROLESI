"use server";

import { construirPdfSimples, formatarColunasPdf, type LinhaPdf } from "@/lib/pdf-simples";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso, hojeIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import type { ItemComCodigoAtacado } from "@/lib/relatorios-varejo";

// Gera o PDF da notinha direto no servidor e devolve em base64 -- pedido do usuário (2026-11-13):
// "preciso de um 'gerar pdf'" em vez de depender do botão Imprimir abrir a caixa de diálogo do
// navegador e o usuário escolher "Salvar como PDF" manualmente (confuso/inconsistente dependendo
// do navegador/dispositivo). Um clique -> baixa o arquivo, sem caixa de diálogo nenhuma no meio.

const LARGURA_CHARS = 70;

export async function gerarPdfDividaAtacado(itens: ItemComCodigoAtacado[]): Promise<{ erro?: string; pdfBase64?: string }> {
  if (itens.length === 0) return { erro: "Nenhuma dívida em aberto pra gerar o PDF." };
  const total = itens.reduce((s, i) => s + i.custo_total, 0);

  const linhas: LinhaPdf[] = [
    { texto: EMPRESA.nome, negrito: true, alinhamento: "centro" },
    { texto: `CNPJ ${EMPRESA.cpfCnpj}`, alinhamento: "centro" },
    { texto: "" },
    { texto: "Dívida com o Atacado — peças vendidas em aberto", negrito: true, alinhamento: "centro" },
    { texto: `Emitido em ${formatarDataIso(hojeIso())}`, alinhamento: "centro" },
    { texto: "" },
    { texto: formatarColunasPdf("Peça / Código", "Valor", LARGURA_CHARS), negrito: true },
    { texto: "-".repeat(LARGURA_CHARS) },
    ...itens.map((i) => ({
      texto: formatarColunasPdf(
        `${i.quantidade}x ${i.produto_nome} cód.${i.codigo_atacado.toLocaleString("pt-BR")}`,
        formatarMoeda(i.custo_total),
        LARGURA_CHARS,
      ),
    })),
    { texto: "-".repeat(LARGURA_CHARS) },
    { texto: formatarColunasPdf("TOTAL EM ABERTO", formatarMoeda(total), LARGURA_CHARS), negrito: true },
    { texto: "" },
    { texto: "" },
    { texto: "Pago em: ____ / ____ / ________" },
    { texto: "" },
    { texto: "Confirmação: ________________________________" },
  ];

  const pdf = construirPdfSimples(linhas, LARGURA_CHARS);
  return { pdfBase64: pdf.toString("base64") };
}
