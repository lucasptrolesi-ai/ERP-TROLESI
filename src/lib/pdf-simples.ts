// PDF de texto simples, sem nenhuma dependência de npm -- mesmo motor que print-agent/agent.js
// (construirPdf) já usa pra gerar o comprovante do cupom em PDF, portado aqui pra rodar no server
// do Next.js (o print-agent só roda na Mac da loja, não é alcançável por um download direto do
// navegador). Fonte Courier (uma das 14 "standard fonts" que todo leitor de PDF já tem embutida,
// não precisa embarcar nada) -- sem imagem, monoespaçada (alinhamento de coluna por padding de
// espaço funciona de verdade, diferente da fonte proporcional do ZPL/térmica).
export type LinhaPdf = { texto: string; negrito?: boolean; alinhamento?: "esquerda" | "centro" | "direita" };

const PAGINA_LARGURA = 595.28; // A4, pt (1pt = 1/72 polegada)
const PAGINA_ALTURA = 841.89;
const MARGEM = 50;
const FONTE_TAMANHO = 12;
const ALTURA_LINHA = FONTE_TAMANHO * 1.35;
const LARGURA_CHAR = FONTE_TAMANHO * 0.6; // Courier: 0.6em por caractere, sempre

function paraWinAnsiBytes(texto: string): Buffer {
  // WinAnsiEncoding (usado pelo /Encoding da fonte abaixo) coincide com Latin-1 pros acentos do
  // português (á-ÿ) -- Buffer.from(..., "latin1") mapeia cada code unit 0-255 pro byte de mesmo
  // valor, exatamente o que precisamos.
  return Buffer.from(texto, "latin1");
}

function escaparPdfBytes(buffer: Buffer): Buffer {
  // Dentro de uma string literal PDF "(...)", ( ) \ precisam vir escapados com \ na frente.
  const partes: number[] = [];
  for (const byte of buffer) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) partes.push(0x5c);
    partes.push(byte);
  }
  return Buffer.from(partes);
}

function construirConteudoPagina(linhasPagina: LinhaPdf[], blocoX: number, larguraBloco: number): Buffer {
  const partes: Buffer[] = [Buffer.from("BT\n", "ascii")];
  let fonteAtual: string | null = null;
  let y = PAGINA_ALTURA - MARGEM;
  for (const linha of linhasPagina) {
    const fonte = linha.negrito ? "/F2" : "/F1";
    if (fonte !== fonteAtual) {
      partes.push(Buffer.from(`${fonte} ${FONTE_TAMANHO} Tf\n`, "ascii"));
      fonteAtual = fonte;
    }
    let x = blocoX;
    if (linha.alinhamento === "centro") {
      x = blocoX + (larguraBloco - linha.texto.length * LARGURA_CHAR) / 2;
    } else if (linha.alinhamento === "direita") {
      x = blocoX + larguraBloco - linha.texto.length * LARGURA_CHAR;
    }
    partes.push(Buffer.from(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(`, "ascii"));
    partes.push(escaparPdfBytes(paraWinAnsiBytes(linha.texto)));
    partes.push(Buffer.from(") Tj\n", "ascii"));
    y -= ALTURA_LINHA;
  }
  partes.push(Buffer.from("ET", "ascii"));
  return Buffer.concat(partes);
}

/** Monta um PDF (A4, fonte Courier) a partir de linhas já formatadas -- quebra em várias páginas
 * sozinho se a lista não couber numa só. `larguraBlocoChars` centraliza o bloco de texto na
 * página (mesma largura usada pra calcular o padding de coluna de quem monta `linhas`, ex:
 * formatarColunas). */
export function construirPdfSimples(linhas: LinhaPdf[], larguraBlocoChars: number): Buffer {
  const larguraBloco = larguraBlocoChars * LARGURA_CHAR;
  const blocoX = (PAGINA_LARGURA - larguraBloco) / 2;
  const linhasPorPagina = Math.max(1, Math.floor((PAGINA_ALTURA - MARGEM * 2) / ALTURA_LINHA));

  const paginas: LinhaPdf[][] = [];
  for (let i = 0; i < linhas.length; i += linhasPorPagina) {
    paginas.push(linhas.slice(i, i + linhasPorPagina));
  }
  if (paginas.length === 0) paginas.push([]);

  const idCatalog = 1;
  const idPages = 2;
  const idFonteRegular = 3;
  const idFonteNegrito = 4;
  const idsPaginas = paginas.map((_, i) => 5 + i * 2);
  const idsConteudos = paginas.map((_, i) => 6 + i * 2);

  const objetos: { id: number; buffer: Buffer }[] = [
    { id: idCatalog, buffer: Buffer.from(`<< /Type /Catalog /Pages ${idPages} 0 R >>`, "ascii") },
    {
      id: idPages,
      buffer: Buffer.from(
        `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(" ")}] /Count ${paginas.length} >>`,
        "ascii",
      ),
    },
    { id: idFonteRegular, buffer: Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>", "ascii") },
    {
      id: idFonteNegrito,
      buffer: Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>", "ascii"),
    },
  ];

  paginas.forEach((linhasPagina, i) => {
    const conteudo = construirConteudoPagina(linhasPagina, blocoX, larguraBloco);
    objetos.push({
      id: idsPaginas[i],
      buffer: Buffer.from(
        `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${PAGINA_LARGURA} ${PAGINA_ALTURA}] ` +
          `/Resources << /Font << /F1 ${idFonteRegular} 0 R /F2 ${idFonteNegrito} 0 R >> >> ` +
          `/Contents ${idsConteudos[i]} 0 R >>`,
        "ascii",
      ),
    });
    objetos.push({
      id: idsConteudos[i],
      buffer: Buffer.concat([
        Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`, "ascii"),
        conteudo,
        Buffer.from("\nendstream", "ascii"),
      ]),
    });
  });

  objetos.sort((a, b) => a.id - b.id);

  const partesArquivo: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [0];
  let posicaoAtual = partesArquivo[0].length;

  for (const objeto of objetos) {
    offsets[objeto.id] = posicaoAtual;
    const bufferObjeto = Buffer.concat([
      Buffer.from(`${objeto.id} 0 obj\n`, "ascii"),
      objeto.buffer,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    partesArquivo.push(bufferObjeto);
    posicaoAtual += bufferObjeto.length;
  }

  const posicaoXref = posicaoAtual;
  const totalObjetos = objetos.length + 1; // +1 pro objeto 0 (livre, sempre presente)
  let xref = `xref\n0 ${totalObjetos}\n0000000000 65535 f \n`;
  for (let id = 1; id < totalObjetos; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${totalObjetos} /Root ${idCatalog} 0 R >>\nstartxref\n${posicaoXref}\n%%EOF`;
  partesArquivo.push(Buffer.from(xref, "ascii"));

  return Buffer.concat(partesArquivo);
}

/** Alinha duas colunas (esquerda/direita) num total de `largura` caracteres -- mesma lógica de
 * formatarColunas no print-agent (cupom térmico), reaproveitada aqui pra alinhar peça/valor na
 * fonte monoespaçada do PDF (Courier). */
export function formatarColunasPdf(esquerda: string, direita: string, largura: number): string {
  const cabe = esquerda.length + direita.length + 1 <= largura;
  return cabe
    ? esquerda + " ".repeat(largura - esquerda.length - direita.length) + direita
    : `${esquerda.slice(0, Math.max(0, largura - direita.length - 1))} ${direita}`;
}
