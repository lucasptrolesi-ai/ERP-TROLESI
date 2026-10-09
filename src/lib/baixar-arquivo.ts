"use client";

/** Baixa um arquivo a partir de base64 (ex: .xlsx gerado no servidor via ExcelJS). */
export function baixarArquivoBase64(base64: string, nomeArquivo: string, tipo: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  baixarBlob(new Blob([bytes], { type: tipo }), nomeArquivo);
}

/** Baixa um arquivo de texto puro (ex: CSV) montado no próprio navegador. */
export function baixarTexto(texto: string, nomeArquivo: string, tipo = "text/csv;charset=utf-8;") {
  baixarBlob(new Blob([texto], { type: tipo }), nomeArquivo);
}

function baixarBlob(blob: Blob, nomeArquivo: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}
