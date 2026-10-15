// Gerador de ZPL pra etiqueta de joia (95×12mm, Elgin L42 Pro Full) — funções puras, sem I/O.
// Geometria e template aprovados com teste físico real (régua + impressão de papel), não inventados
// aqui — ver DECISIONS.md "Etiqueta de joia 95×12mm" pra o porquê de cada escolha (em especial por
// que o QR vira bitmap ^GFA em vez do comando nativo ^BQ, que sai cortado nesta impressora).
//
// Duplicado em print-agent/etiqueta-zpl.js (JS puro, sem dependência de build) porque é o print-agent
// — rodando isolado numa Mac da loja, instalado como pasta copiada — quem de fato monta o ZPL na hora
// de imprimir; este módulo aqui serve a pré-visualização ao vivo na tela e os testes. Um teste de
// consistência (zpl.consistencia.test.ts) garante que as duas cópias produzem o mesmo ZPL pra a
// mesma entrada.
import QRCode from "qrcode";
import { formatarAtributos } from "@/lib/varejo/atributos";

export type DadosEtiqueta = {
  linha1: string;
  preco: string;
  linha3: string;
  codigo: string;
  quantidade: number;
};

export const ETIQUETA_LINHA3_MAX = 20;
export const ETIQUETA_CODIGO_MAX = 8;
// Mesmo limite do check (char_length(...) <= 20) de linha1/preco em solicitacoes_etiqueta
// (migration 20261015000001) — linha1/preco não têm pré-preenchimento truncado como linha3/codigo
// (não vêm de texto livre arbitrário: linha1 é sempre "TROLESI", preco já sai formatado curto), mas
// o campo na tela continua editável, então precisa do mesmo limite pra nunca estourar o check do banco.
export const ETIQUETA_LINHA1_PRECO_MAX = 20;

/** ^ ~ \ têm significado de comando/escape em ZPL — num campo de texto livre (^FD...^FS) eles
 * quebrariam o resto do template. Removidos (não trocados por outro caractere) porque nenhum desses
 * três apareceria de propósito num nome de peça/preço/código real. */
export function sanitizarCampoZpl(texto: string): string {
  return String(texto ?? "").replace(/[\^~\\]/g, "");
}

/** Bitmap ^GFA do QR code, codificando `texto` — escala de `escalaDots` dots por módulo (padrão 3,
 * validado na impressão real como o tamanho que cabe ao lado do SKU sem cortar). Sem quiet zone (a
 * biblioteca `qrcode` já devolve só os módulos do símbolo, sem borda) — a margem na etiqueta vem só
 * do posicionamento `^FO`, de propósito, pra aproveitar os poucos milímetros disponíveis.
 * Devolve os 3 parâmetros numéricos + hex já no formato que `^GFA,` espera (totalBytes,totalBytes,
 * bytesPorLinha,hex). */
export function gerarBitmapQrGfa(texto: string, escalaDots = 3): string {
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const tamanho = qr.modules.size;
  const larguraDots = tamanho * escalaDots;
  const bytesPorLinha = Math.ceil(larguraDots / 8);
  const bitsPorLinha = bytesPorLinha * 8;

  const linhasDeBits: number[][] = [];
  for (let linha = 0; linha < tamanho; linha++) {
    const bits: number[] = [];
    for (let coluna = 0; coluna < tamanho; coluna++) {
      const bit = qr.modules.get(linha, coluna) ? 1 : 0;
      for (let e = 0; e < escalaDots; e++) bits.push(bit);
    }
    while (bits.length < bitsPorLinha) bits.push(0);
    // Escala vertical: cada linha do QR vira `escalaDots` linhas idênticas no bitmap de saída.
    for (let repete = 0; repete < escalaDots; repete++) linhasDeBits.push(bits);
  }

  const bytes: number[] = [];
  for (const bits of linhasDeBits) {
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i + b] ?? 0);
      bytes.push(byte);
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  const totalBytes = bytesPorLinha * larguraDots; // QR é quadrado: alturaDots === larguraDots

  return `${totalBytes},${totalBytes},${bytesPorLinha},${hex}`;
}

/** Template ZPL aprovado (ver DECISIONS.md) — posições/tamanhos de fonte não são arbitrários, foram
 * medidos na etiqueta física real (95×12mm, 203dpi). Não mexer sem reimprimir e remedir. */
export function gerarZpl(dados: DadosEtiqueta): string {
  const linha1 = sanitizarCampoZpl(dados.linha1);
  const preco = sanitizarCampoZpl(dados.preco);
  const linha3 = sanitizarCampoZpl(dados.linha3);
  const codigo = sanitizarCampoZpl(dados.codigo);
  const quantidade = Math.max(1, Math.round(dados.quantidade) || 1);
  const qrGfa = gerarBitmapQrGfa(codigo);

  return [
    "^XA",
    "^CI28",
    "^MTT",
    "^MNY",
    "^PR2,2",
    "^MD5",
    "^PW760",
    "^LL96",
    "^LH0,0",
    `^FO16,10^FB184,1,0,C^A0N,18,18^FD${linha1}^FS`,
    `^FO16,30^FB184,1,0,C^A0N,34,26^FD${preco}^FS`,
    `^FO16,68^FB184,1,0,C^A0N,18,14^FD${linha3}^FS`,
    `^FO216,16^GFA,${qrGfa}^FS`,
    "^FO285,26^A0N,20,14^FDSKU^FS",
    `^FO285,50^A0N,20,12^FD${codigo}^FS`,
    `^PQ${quantidade}`,
    "^XZ",
  ].join("\n");
}

/** Pré-preenchimento a partir dos dados já salvos da peça — o que abre na tela "Imprimir etiqueta"
 * antes do dono editar qualquer coisa. Trunca em vez de rejeitar: o valor sempre sai válido pro
 * template, e o dono ainda pode editar/encurtar manualmente na tela se achar que cortou errado. */
export function preencherEtiquetaAPartirDaPeca(dados: {
  precoVenda: number;
  precoFormatado: string;
  atributos: Record<string, string> | null | undefined;
  categoria: string | null;
  sku: string;
  quantidadeEstoque?: number | null;
}): DadosEtiqueta {
  const linha3Bruta = formatarAtributos(dados.atributos) || dados.categoria || "";
  return {
    linha1: "TROLESI",
    preco: dados.precoFormatado,
    linha3: linha3Bruta.slice(0, ETIQUETA_LINHA3_MAX),
    codigo: (dados.sku ?? "").slice(0, ETIQUETA_CODIGO_MAX),
    quantidade: dados.quantidadeEstoque && dados.quantidadeEstoque > 0 ? Math.round(dados.quantidadeEstoque) : 1,
  };
}
