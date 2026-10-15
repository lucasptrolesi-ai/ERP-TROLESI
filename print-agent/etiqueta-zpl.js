// Gerador de ZPL pra etiqueta de joia (95×12mm, Elgin L42 Pro Full) — mesma lógica de
// src/lib/etiquetas/zpl.ts (TypeScript, testado com Vitest), duplicada aqui em JS puro porque este
// agente roda isolado numa Mac da loja, instalado como pasta copiada (ver README.md) — não importa
// nada de fora de print-agent/. Um teste de consistência no app principal
// (src/lib/etiquetas/zpl.consistencia.test.ts) garante que as duas cópias produzem o mesmo ZPL pra
// a mesma entrada; qualquer mudança aqui precisa ser espelhada lá também (e vice-versa).
"use strict";

const QRCode = require("qrcode");

const ETIQUETA_LINHA3_MAX = 20;
const ETIQUETA_CODIGO_MAX = 8;

function sanitizarCampoZpl(texto) {
  return String(texto == null ? "" : texto).replace(/[\^~\\]/g, "");
}

function gerarBitmapQrGfa(texto, escalaDots) {
  escalaDots = escalaDots || 3;
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const tamanho = qr.modules.size;
  const larguraDots = tamanho * escalaDots;
  const bytesPorLinha = Math.ceil(larguraDots / 8);
  const bitsPorLinha = bytesPorLinha * 8;

  const linhasDeBits = [];
  for (let linha = 0; linha < tamanho; linha++) {
    const bits = [];
    for (let coluna = 0; coluna < tamanho; coluna++) {
      const bit = qr.modules.get(linha, coluna) ? 1 : 0;
      for (let e = 0; e < escalaDots; e++) bits.push(bit);
    }
    while (bits.length < bitsPorLinha) bits.push(0);
    for (let repete = 0; repete < escalaDots; repete++) linhasDeBits.push(bits);
  }

  const bytes = [];
  for (const bits of linhasDeBits) {
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i + b] || 0);
      bytes.push(byte);
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  const totalBytes = bytesPorLinha * larguraDots;

  return `${totalBytes},${totalBytes},${bytesPorLinha},${hex}`;
}

function gerarZpl(dados) {
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

module.exports = { sanitizarCampoZpl, gerarBitmapQrGfa, gerarZpl, ETIQUETA_LINHA3_MAX, ETIQUETA_CODIGO_MAX };
