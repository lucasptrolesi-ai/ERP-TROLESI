import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso, formatarDataHoraIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import type { LinhaImpressao } from "@/lib/cupom-linhas";
import type { ResumoFechamentoCaixa } from "@/lib/fechamento-caixa-evento";
import type { MovimentoCaixaEvento } from "@/lib/types";

// Mesmo formato de linhas do cupom de venda (cupom-linhas-evento.ts) —
// reaproveita o print-agent local sem mudar nada nele. Usa via "loja" na
// hora de imprimir (só existe uma via, não faz sentido "via cliente" pra um
// resumo interno de caixa) — cosmético: o PDF de backup do print-agent
// nomeia como "Evento - DD-MM.pdf" (mesmo nome genérico de venda de
// evento), já que ele não distingue os dois tipos de solicitação.
export function construirLinhasFechamentoCaixa(
  dataIso: string,
  resumo: ResumoFechamentoCaixa,
  movimentos: MovimentoCaixaEvento[],
): LinhaImpressao[] {
  const linhas: LinhaImpressao[] = [];

  linhas.push({ tipo: "texto", texto: `${EMPRESA.nome} — AGROSHOW`, alinhamento: "centro", negrito: true });
  linhas.push({ tipo: "texto", texto: "FECHAMENTO DE CAIXA", alinhamento: "centro", negrito: true });
  linhas.push({ tipo: "texto", texto: formatarDataIso(dataIso), alinhamento: "centro" });
  linhas.push({ tipo: "texto", texto: `Emitido: ${formatarDataHoraIso(new Date().toISOString())}`, alinhamento: "centro" });
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "colunas", esquerda: "Abertura do caixa", direita: formatarMoeda(resumo.valorAbertura) });
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "colunas", esquerda: "Dinheiro", direita: formatarMoeda(resumo.porFormaPagamento.dinheiro) });
  linhas.push({ tipo: "colunas", esquerda: "Pix", direita: formatarMoeda(resumo.porFormaPagamento.pix) });
  linhas.push({
    tipo: "colunas",
    esquerda: "Cartão à vista",
    direita: formatarMoeda(resumo.porFormaPagamento.cartao_vista),
  });
  linhas.push({
    tipo: "colunas",
    esquerda: "Cartão parcelado",
    direita: formatarMoeda(resumo.porFormaPagamento.cartao_parcelado),
  });
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "colunas", esquerda: "Total vendido", direita: formatarMoeda(resumo.totalVendido), negrito: true });
  if (resumo.totalDescontos > 0) {
    linhas.push({ tipo: "colunas", esquerda: "Descontos", direita: `- ${formatarMoeda(resumo.totalDescontos)}` });
  }
  linhas.push({ tipo: "linha" });

  linhas.push({ tipo: "texto", texto: "Movimentos do caixa", negrito: true });
  if (movimentos.length === 0) {
    linhas.push({ tipo: "texto", texto: "Nenhum movimento hoje." });
  } else {
    for (const m of movimentos) {
      const sinal = m.tipo === "entrada" ? "+" : "-";
      linhas.push({ tipo: "colunas", esquerda: m.motivo, direita: `${sinal} ${formatarMoeda(m.valor)}` });
    }
  }
  linhas.push({ tipo: "colunas", esquerda: "Total entradas", direita: formatarMoeda(resumo.totalEntradas) });
  linhas.push({ tipo: "colunas", esquerda: "Total retiradas", direita: formatarMoeda(resumo.totalRetiradas) });
  linhas.push({ tipo: "linha" });

  linhas.push({
    tipo: "colunas",
    esquerda: "SALDO EM DINHEIRO",
    direita: formatarMoeda(resumo.saldoDinheiro),
    negrito: true,
  });

  return linhas;
}
