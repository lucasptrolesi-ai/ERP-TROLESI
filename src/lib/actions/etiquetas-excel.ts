"use server";

import ExcelJS from "exceljs";

// Exportação genérica pro app da Niimbot (importa Excel e imprime em lote) —
// pedido do usuário 2026-08-18: o app não fala com o navegador (Bluetooth
// só funciona a partir do app oficial), então a ponte é um arquivo .xlsx
// com o que o app precisa: código da peça, preço e código de barras. O
// código de barras impresso sempre foi o próprio codigo_interno (mesmo
// padrão usado na etiqueta em tela de Estoque e PDV Eventos), então as duas
// colunas recebem o mesmo valor.
export async function exportarEtiquetasExcel(
  itens: { codigo: string; preco: number }[],
): Promise<{ erro?: string; base64?: string }> {
  if (itens.length === 0) return { erro: "Nenhuma peça pra exportar." };

  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet("Etiquetas");
  planilha.columns = [
    { header: "Código da Peça", key: "codigo", width: 18 },
    { header: "Preço", key: "preco", width: 12 },
    { header: "Código de Barras", key: "barras", width: 18 },
  ];
  for (const item of itens) {
    planilha.addRow({ codigo: item.codigo, preco: item.preco, barras: item.codigo });
  }
  planilha.getColumn("preco").numFmt = "0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  return { base64: Buffer.from(buffer).toString("base64") };
}
