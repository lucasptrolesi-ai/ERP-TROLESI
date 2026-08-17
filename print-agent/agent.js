// Print-agent local do ERP Trolesi — roda só nesse PC (o mesmo onde a
// impressora térmica está instalada e compartilhada no Windows). Fica
// checando a tabela `solicitacoes_impressao` no Supabase (gravada pelo
// navegador, de qualquer aparelho — Mac, Windows, celular) e manda cada
// pedido pendente direto pra fila de impressão em modo RAW (ESC/POS), sem
// passar pelo desenho/rasterização de página do navegador — é isso que dá
// a qualidade nítida (igual a de um sistema nativo como o GMax) em vez do
// texto borrado que sai ao imprimir uma página HTML numa impressora
// térmica.
//
// Por que polling no banco em vez do navegador chamar esse PC direto: a
// venda pode ser fechada de QUALQUER computador/celular da loja, não só
// deste aqui — um fetch direto pro loopback (127.0.0.1) só funcionaria se
// o navegador estivesse rodando nesta mesma máquina. Com o banco no meio,
// não importa de onde a venda saiu, só importa que ESTE processo (rodando
// onde a impressora está ligada) está de olho na fila.
//
// Como imprime de fato (testado na prática, ver DECISIONS.md):
// 1. Monta os comandos ESC/POS (negrito, alinhamento, corte) num buffer.
// 2. Grava o buffer num arquivo temporário.
// 3. Copia o arquivo (modo binário) pra fila compartilhada da impressora
//    no Windows (\\<MAQUINA>\<COMPARTILHAMENTO>) — isso entrega os bytes
//    direto pro spooler em modo RAW, sem reprocessar.
//
// Não usa nenhuma dependência de npm de propósito — só módulos nativos do
// Node — pra não exigir "npm install" na hora de configurar numa loja.
//
// Exceção (2026-08-14): a impressão de ETIQUETA de código de barras
// (Argox OS-214TT, PDV Eventos) usa 3 dependências de npm — bwip-js
// (desenha o código de barras), pdfkit (monta o PDF do tamanho exato da
// etiqueta) e pdf-to-printer (manda o PDF pro nome exato da impressora
// Windows, via SumatraPDF por baixo). Diferente do cupom térmico (que só
// precisa mandar bytes ESC/POS crus), a etiqueta precisa passar pelo
// driver Windows já calibrado (tamanho/gap/offset — ver DECISIONS.md
// 2026-08-14), e reinventar isso na mão é como travamos semanas tentando
// no Mac sem sucesso. Ver README.md pra instalar (`npm install` só uma
// vez, só nesta pasta). Se as dependências não estiverem instaladas, a
// impressão de etiqueta fica desativada automaticamente — o cupom
// térmico continua funcionando normalmente (ver bloco logo abaixo).
"use strict";

const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

let bwipjs;
let PDFDocument;
let imprimirArquivoNaImpressora;
let etiquetaDisponivel = true;
try {
  bwipjs = require("bwip-js");
  PDFDocument = require("pdfkit");
  ({ print: imprimirArquivoNaImpressora } = require("pdf-to-printer"));
} catch (erro) {
  etiquetaDisponivel = false;
  console.warn(
    "Impressão de etiqueta desativada — dependências não instaladas. Rode 'npm install' na pasta print-agent " +
      "pra ativar (ver README.md). O cupom térmico continua funcionando normalmente. Detalhe:",
    erro.message,
  );
}

carregarEnvLocal();

const COMPARTILHAMENTO_IMPRESSORA = process.env.IMPRESSORA_COMPARTILHAMENTO || "ELGIN i8";
const MAQUINA = os.hostname();
const COLUNAS = 48; // confirmado na prática pra Elgin i8 58mm (48mm úteis)
const INTERVALO_POLLING_MS = Number(process.env.INTERVALO_POLLING_MS) || 2000;
// Pasta onde o comprovante em PDF é salvo (pra encaminhar manualmente pro
// cliente via WhatsApp, ver README.md) — organizada em <ano>/<mes>/
// "Cliente - DD-MM.pdf", igual pedido explícito do usuário 2026-07-25.
const PASTA_COMPROVANTES = process.env.PASTA_COMPROVANTES || path.join(os.homedir(), "Desktop", "Comprovante");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — crie um arquivo print-agent/.env (ver README.md).",
  );
  process.exit(1);
}

// Carrega print-agent/.env manualmente (sem depender do pacote `dotenv`,
// pra manter o agente sem nenhuma dependência de npm). Só preenche
// variáveis que ainda não existem no ambiente.
function carregarEnvLocal() {
  const caminhoEnv = path.join(__dirname, ".env");
  if (!fs.existsSync(caminhoEnv)) return;
  const conteudo = fs.readFileSync(caminhoEnv, "utf8");
  for (const linha of conteudo.split("\n")) {
    const linhaLimpa = linha.trim();
    if (!linhaLimpa || linhaLimpa.startsWith("#")) continue;
    const indiceIgual = linhaLimpa.indexOf("=");
    if (indiceIgual === -1) continue;
    const chave = linhaLimpa.slice(0, indiceIgual).trim();
    const valor = linhaLimpa.slice(indiceIgual + 1).trim();
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

const ESC = 0x1b;
const GS = 0x1d;

const MAPA_ACENTOS = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", é: "e", ê: "e", è: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i", ó: "o", ô: "o", õ: "o", ò: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n",
  Á: "A", À: "A", Â: "A", Ã: "A", Ä: "A", É: "E", Ê: "E", È: "E", Ë: "E",
  Í: "I", Ì: "I", Î: "I", Ï: "I", Ó: "O", Ô: "O", Õ: "O", Ò: "O", Ö: "O",
  Ú: "U", Ù: "U", Û: "U", Ü: "U", Ç: "C", Ñ: "N",
};

// A impressora não teve o code page de acentos confirmado ainda (testar
// errado sai como caractere garbled, pior que sem acento) — tira o acento
// por segurança até validar isso na prática. Depois de trocar os acentos
// conhecidos, qualquer outro caractere fora do ASCII (traço longo, aspas
// curvas etc.) vira um caractere seguro em vez de virar lixo no buffer —
// Buffer.from(..., "ascii") corta o bit mais alto de cada caractere, então
// um caractere não mapeado sairia como símbolo aleatório no papel.
function semAcento(texto) {
  return String(texto ?? "")
    .replace(/[áàâãäéêèëíìîïóôõòöúùûüçñÁÀÂÃÄÉÊÈËÍÌÎÏÓÔÕÒÖÚÙÛÜÇÑ]/g, (c) => MAPA_ACENTOS[c] ?? c)
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7E]/g, " ");
}

const ALINHAMENTO_CODIGO = { esquerda: 0, centro: 1, direita: 2 };

// Padding de coluna esquerda/direita (item + preço, etc.) — extraído aqui
// pra ser reaproveitado tal e qual pelo construirPdf() abaixo. Não mexe em
// acento (quem chama decide: ESC/POS aplica semAcento antes, PDF mantém
// acentuado — WinAnsiEncoding do PDF suporta português direito).
function formatarColunas(esquerda, direita) {
  const cabe = esquerda.length + direita.length + 1 <= COLUNAS;
  return cabe
    ? esquerda + " ".repeat(COLUNAS - esquerda.length - direita.length) + direita
    : `${esquerda.slice(0, Math.max(0, COLUNAS - direita.length - 1))} ${direita}`;
}

function construirEscPos(linhas) {
  const partes = [Buffer.from([ESC, 0x40])]; // inicializa

  for (const linha of linhas) {
    if (linha.tipo === "espaco") {
      partes.push(Buffer.from("\n".repeat(linha.linhas ?? 1), "ascii"));
      continue;
    }

    if (linha.tipo === "linha") {
      partes.push(Buffer.from([ESC, 0x61, 0]));
      partes.push(Buffer.from(`${"-".repeat(COLUNAS)}\n`, "ascii"));
      continue;
    }

    if (linha.tipo === "colunas") {
      const texto = formatarColunas(semAcento(linha.esquerda), semAcento(linha.direita));
      partes.push(Buffer.from([ESC, 0x61, 0]));
      partes.push(Buffer.from([ESC, 0x45, linha.negrito ? 1 : 0]));
      partes.push(Buffer.from(`${texto}\n`, "ascii"));
      partes.push(Buffer.from([ESC, 0x45, 0]));
      continue;
    }

    // tipo === "texto"
    partes.push(Buffer.from([ESC, 0x61, ALINHAMENTO_CODIGO[linha.alinhamento ?? "esquerda"] ?? 0]));
    partes.push(Buffer.from([ESC, 0x45, linha.negrito ? 1 : 0]));
    partes.push(Buffer.from(`${semAcento(linha.texto)}\n`, "ascii"));
    partes.push(Buffer.from([ESC, 0x45, 0]));
  }

  partes.push(Buffer.from("\n\n\n", "ascii"));
  partes.push(Buffer.from([GS, 0x56, 0])); // corte total

  return Buffer.concat(partes);
}

// Mesma normalização de linhas (espaço/linha/colunas/texto) que a impressora
// térmica usa, só que mantendo acento (o PDF usa WinAnsiEncoding, que cobre
// português direito — diferente da térmica, que ainda não teve o code page
// de acentos confirmado, ver limitação conhecida no README).
function linhasParaTextoSimples(linhas) {
  const saida = [];
  for (const linha of linhas) {
    if (linha.tipo === "espaco") {
      for (let i = 0; i < (linha.linhas ?? 1); i++) {
        saida.push({ texto: "", negrito: false, alinhamento: "esquerda" });
      }
      continue;
    }
    if (linha.tipo === "linha") {
      saida.push({ texto: "-".repeat(COLUNAS), negrito: false, alinhamento: "esquerda" });
      continue;
    }
    if (linha.tipo === "colunas") {
      saida.push({
        texto: formatarColunas(linha.esquerda, linha.direita),
        negrito: Boolean(linha.negrito),
        alinhamento: "esquerda",
      });
      continue;
    }
    saida.push({
      texto: linha.texto,
      negrito: Boolean(linha.negrito),
      alinhamento: linha.alinhamento ?? "esquerda",
    });
  }
  return saida;
}

// --- Geração de PDF (comprovante pra encaminhar ao cliente por WhatsApp) ---
// Sem nenhuma dependência de npm de propósito (mesmo espírito do resto do
// agente) — um PDF de texto simples (sem imagem, sem fonte embarcada) é
// simples o bastante pra montar o formato PDF na mão: um objeto de página
// por página de conteúdo, fonte monoespaçada padrão (Courier, um dos 14
// "standard fonts" que todo leitor de PDF já tem embutido, não precisa
// embarcar) — o mesmo cálculo de padding de coluna (formatarColunas) que já
// existe pro ESC/POS é reaproveitado aqui, então o alinhamento das
// colunas fica idêntico ao do cupom térmico.
const PDF_PAGINA_LARGURA = 595.28; // A4, pt (1pt = 1/72 polegada)
const PDF_PAGINA_ALTURA = 841.89;
const PDF_MARGEM = 50;
const PDF_FONTE_TAMANHO = 12;
const PDF_ALTURA_LINHA = PDF_FONTE_TAMANHO * 1.35;
const PDF_LARGURA_CHAR = PDF_FONTE_TAMANHO * 0.6; // Courier: 0.6em por caractere, sempre

function paraWinAnsiBytes(texto) {
  // WinAnsiEncoding (usado pelo /Encoding da fonte abaixo) coincide com
  // Latin-1 pros acentos do português (á-ÿ) — Buffer.from(..., "latin1")
  // mapeia cada code unit 0-255 pro byte de mesmo valor, exatamente o que
  // precisamos.
  return Buffer.from(texto, "latin1");
}

function escaparPdfBytes(buffer) {
  // Dentro de uma string literal PDF "(...)", ( ) \ precisam vir escapados
  // com \ na frente.
  const partes = [];
  for (const byte of buffer) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) partes.push(0x5c);
    partes.push(byte);
  }
  return Buffer.from(partes);
}

function construirConteudoPaginaPdf(linhasPagina, blocoX, larguraBloco) {
  const partes = [Buffer.from("BT\n", "ascii")];
  let fonteAtual = null;
  let y = PDF_PAGINA_ALTURA - PDF_MARGEM;
  for (const linha of linhasPagina) {
    const fonte = linha.negrito ? "/F2" : "/F1";
    if (fonte !== fonteAtual) {
      partes.push(Buffer.from(`${fonte} ${PDF_FONTE_TAMANHO} Tf\n`, "ascii"));
      fonteAtual = fonte;
    }
    let x = blocoX;
    if (linha.alinhamento === "centro") {
      x = blocoX + (larguraBloco - linha.texto.length * PDF_LARGURA_CHAR) / 2;
    }
    partes.push(Buffer.from(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(`, "ascii"));
    partes.push(escaparPdfBytes(paraWinAnsiBytes(linha.texto)));
    partes.push(Buffer.from(") Tj\n", "ascii"));
    y -= PDF_ALTURA_LINHA;
  }
  partes.push(Buffer.from("ET", "ascii"));
  return Buffer.concat(partes);
}

function construirPdf(linhasEstruturadas) {
  const linhasTexto = linhasParaTextoSimples(linhasEstruturadas);
  const larguraBloco = COLUNAS * PDF_LARGURA_CHAR;
  const blocoX = (PDF_PAGINA_LARGURA - larguraBloco) / 2;
  const linhasPorPagina = Math.max(
    1,
    Math.floor((PDF_PAGINA_ALTURA - PDF_MARGEM * 2) / PDF_ALTURA_LINHA),
  );

  const paginasLinhas = [];
  for (let i = 0; i < linhasTexto.length; i += linhasPorPagina) {
    paginasLinhas.push(linhasTexto.slice(i, i + linhasPorPagina));
  }
  if (paginasLinhas.length === 0) paginasLinhas.push([]);

  const idCatalog = 1;
  const idPages = 2;
  const idFonteRegular = 3;
  const idFonteNegrito = 4;
  const idsPaginas = paginasLinhas.map((_, i) => 5 + i * 2);
  const idsConteudos = paginasLinhas.map((_, i) => 6 + i * 2);

  const objetos = [
    { id: idCatalog, buffer: Buffer.from(`<< /Type /Catalog /Pages ${idPages} 0 R >>`, "ascii") },
    {
      id: idPages,
      buffer: Buffer.from(
        `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(" ")}] /Count ${paginasLinhas.length} >>`,
        "ascii",
      ),
    },
    {
      id: idFonteRegular,
      buffer: Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>", "ascii"),
    },
    {
      id: idFonteNegrito,
      buffer: Buffer.from(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
        "ascii",
      ),
    },
  ];

  paginasLinhas.forEach((linhasPagina, i) => {
    const conteudo = construirConteudoPaginaPdf(linhasPagina, blocoX, larguraBloco);
    objetos.push({
      id: idsPaginas[i],
      buffer: Buffer.from(
        `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${PDF_PAGINA_LARGURA} ${PDF_PAGINA_ALTURA}] ` +
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

  const partesArquivo = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
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

function enviarParaImpressora(buffer) {
  return new Promise((resolve, reject) => {
    const arquivoTemp = path.join(os.tmpdir(), `cupom_erp_trolesi_${Date.now()}.prn`);
    fs.writeFile(arquivoTemp, buffer, (erroEscrita) => {
      if (erroEscrita) return reject(erroEscrita);
      const destino = `\\\\${MAQUINA}\\${COMPARTILHAMENTO_IMPRESSORA}`;
      execFile("cmd", ["/c", "copy", "/b", arquivoTemp, destino], (erroExec) => {
        fs.unlink(arquivoTemp, () => {});
        if (erroExec) return reject(erroExec);
        resolve();
      });
    });
  });
}

// Chamada genérica pra API REST (PostgREST) do Supabase, autenticada com a
// service_role key — essa key ignora RLS de propósito (é o mesmo padrão já
// usado no resto do projeto pra ações administrativas server-side, nunca
// exposta ao navegador).
function requisicaoSupabase(caminho, metodo, corpoObjeto) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1${caminho}`);
    const corpo = corpoObjeto ? JSON.stringify(corpoObjeto) : undefined;
    const cabecalhos = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };
    if (metodo === "PATCH") cabecalhos.Prefer = "return=minimal";
    if (corpo) cabecalhos["Content-Length"] = Buffer.byteLength(corpo);

    const req = https.request(url, { method: metodo, headers: cabecalhos }, (res) => {
      let corpoResposta = "";
      res.on("data", (pedaco) => {
        corpoResposta += pedaco;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(corpoResposta ? JSON.parse(corpoResposta) : null);
        } else {
          reject(new Error(`Supabase respondeu ${res.statusCode}: ${corpoResposta}`));
        }
      });
    });
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function buscarPendentes() {
  return requisicaoSupabase(
    "/solicitacoes_impressao?status=eq.pendente&order=criado_em.asc&limit=5&select=id,via,linhas,pedido_id,criado_em",
    "GET",
  );
}

function sanitizarNomeArquivo(nome) {
  // Caracteres inválidos em nome de arquivo no Windows: \ / : * ? " < > |
  return String(nome ?? "Cliente").replace(/[\\/:*?"<>|]/g, "_").trim() || "Cliente";
}

// Meio-dia Brasília (UTC-3 fixo, sem horário de verão desde 2019) em vez de
// meio-dia UTC — mesma lição de fuso já aplicada em vários lugares do
// projeto (ver src/lib/datas.ts): converter ingenuamente (só olhar a data
// UTC) rola pro dia errado perto da meia-noite.
function dataBrasiliaDDMM(isoString) {
  const data = new Date(isoString);
  const dataBrasilia = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  const dd = String(dataBrasilia.getUTCDate()).padStart(2, "0");
  const mm = String(dataBrasilia.getUTCMonth() + 1).padStart(2, "0");
  const aaaa = String(dataBrasilia.getUTCFullYear());
  return { dd, mm, aaaa };
}

// Acha um caminho de arquivo livre pro comprovante — acrescenta " (2)",
// " (3)"... se já existir um arquivo com esse nome (ex: dois clientes
// "CONSUMIDOR" vendendo no mesmo dia) pra nunca sobrescrever o comprovante
// de uma venda diferente.
function caminhoComprovanteDisponivel(pasta, nomeBase) {
  let candidato = path.join(pasta, `${nomeBase}.pdf`);
  let contador = 2;
  while (fs.existsSync(candidato)) {
    candidato = path.join(pasta, `${nomeBase} (${contador}).pdf`);
    contador += 1;
  }
  return candidato;
}

async function buscarInfoPedido(pedidoId) {
  const resultado = await requisicaoSupabase(
    `/pedidos?id=eq.${pedidoId}&select=numero,criado_em,clientes(nome)`,
    "GET",
  );
  return resultado && resultado[0] ? resultado[0] : null;
}

// Salva o mesmo conteúdo do cupom em PDF numa pasta organizada por
// ano/mês na área de trabalho — pra encaminhar manualmente pro cliente via
// WhatsApp (pedido direto do usuário, 2026-07-25). Só chamado pra via
// "loja" (ver processarPendentes) — via "loja" sempre imprime exatamente
// uma vez por venda finalizada (auto-print), enquanto via "cliente" é
// opcional e pode repetir (reimpressão), o que geraria comprovantes
// duplicados/renomeados à toa se gerássemos em toda impressão.
async function salvarComprovantePdf(solicitacao) {
  let dataReferencia;
  let nomeBase;

  if (solicitacao.pedido_id) {
    const pedido = await buscarInfoPedido(solicitacao.pedido_id);
    if (!pedido) return;
    dataReferencia = pedido.criado_em;
    nomeBase = sanitizarNomeArquivo(pedido.clientes?.nome);
  } else {
    // Venda do PDV Eventos (2026-08-13): sem pedido/cliente vinculado no
    // sistema real — usa a data da própria solicitação de impressão (feita
    // segundos depois da venda) e um nome genérico, já que a venda é
    // anônima. Achado de code review: antes disso a function simplesmente
    // desistia (`if (!pedido_id) return`), então nenhuma venda de evento
    // gerava comprovante em PDF, apesar da tela avisar o vendedor que o
    // PDF "já foi salvo automaticamente".
    dataReferencia = solicitacao.criado_em;
    nomeBase = "Evento";
  }

  const { dd, mm, aaaa } = dataBrasiliaDDMM(dataReferencia);
  const pasta = path.join(PASTA_COMPROVANTES, aaaa, mm);
  fs.mkdirSync(pasta, { recursive: true });

  const caminho = caminhoComprovanteDisponivel(pasta, `${nomeBase} - ${dd}-${mm}`);

  const pdf = construirPdf(Array.isArray(solicitacao.linhas) ? solicitacao.linhas : []);
  fs.writeFileSync(caminho, pdf);
  console.log(`Comprovante salvo: ${caminho}`);
}

function marcarComoImpresso(id) {
  return requisicaoSupabase(`/solicitacoes_impressao?id=eq.${id}`, "PATCH", {
    status: "impresso",
    impresso_em: new Date().toISOString(),
  });
}

function marcarComoErro(id, mensagemErro) {
  return requisicaoSupabase(`/solicitacoes_impressao?id=eq.${id}`, "PATCH", {
    status: "erro",
    erro: mensagemErro,
  });
}

async function processarPendentes() {
  let pendentes;
  try {
    pendentes = await buscarPendentes();
  } catch (erro) {
    console.error("Erro ao buscar solicitações pendentes:", erro.message);
    return;
  }

  for (const solicitacao of pendentes) {
    // Comprovante em PDF é uma preocupação independente da impressão física
    // — só na via "loja" (sempre exatamente 1x por venda, ver comentário de
    // salvarComprovantePdf), e tentado ANTES/fora do try da impressora, pra
    // uma impressora offline não impedir o comprovante de ser salvo (e
    // vice-versa: um erro ao salvar o PDF não deve impedir a impressão).
    if (solicitacao.via === "loja") {
      try {
        await salvarComprovantePdf(solicitacao);
      } catch (erroPdf) {
        console.error(`Erro ao salvar comprovante em PDF (solicitação ${solicitacao.id}):`, erroPdf.message);
      }
    }

    try {
      const buffer = construirEscPos(Array.isArray(solicitacao.linhas) ? solicitacao.linhas : []);
      await enviarParaImpressora(buffer);
      await marcarComoImpresso(solicitacao.id);
      console.log(`Impresso: solicitação ${solicitacao.id} (via ${solicitacao.via})`);
    } catch (erro) {
      const mensagem = String((erro && erro.message) || erro);
      console.error(`Erro ao imprimir solicitação ${solicitacao.id}:`, mensagem);
      try {
        await marcarComoErro(solicitacao.id, mensagem);
      } catch (erroAoMarcar) {
        // Se nem isso funcionar (ex: Supabase fora do ar), a solicitação
        // fica "pendente" e é tentada de novo no próximo ciclo — não é
        // ideal (pode imprimir duas vezes se o erro original for só de
        // rede), mas é mais seguro que perder a venda silenciosamente.
        console.error(`Erro ao marcar solicitação ${solicitacao.id} como erro:`, erroAoMarcar.message);
      }
    }
  }
}

// ===================== Etiqueta de código de barras =====================
// PDV Eventos (2026-08-14) — mesmo padrão de fila/polling do cupom, tabela
// separada (`solicitacoes_etiqueta`) porque o conteúdo é bem mais simples
// (só código + nome, sem via/pedido). Ver comentário no topo do arquivo
// sobre as dependências de npm usadas só aqui.

const IMPRESSORA_ETIQUETA = process.env.IMPRESSORA_ETIQUETA || "Argox OS-214TT PPLA";
// Medido com paquímetro (ver DECISIONS.md, 2026-08-13) — tem que bater com
// o papel de etiqueta configurado como padrão no driver Windows já
// calibrado (Preferências de impressão > Papel de etiquetas), senão volta
// a "vazar" pra etiqueta vizinha como no primeiro teste.
const ETIQUETA_LARGURA_MM = 21;
const ETIQUETA_ALTURA_MM = 7;
const MM_PARA_PT = 2.83465; // 1mm em pontos PDF (72pt = 1 polegada)

function buscarEtiquetasPendentes() {
  return requisicaoSupabase(
    "/solicitacoes_etiqueta?status=eq.pendente&order=criado_em.asc&limit=5&select=id,codigo_interno,nome",
    "GET",
  );
}

function marcarEtiquetaComoImpressa(id) {
  return requisicaoSupabase(`/solicitacoes_etiqueta?id=eq.${id}`, "PATCH", {
    status: "impresso",
    impresso_em: new Date().toISOString(),
  });
}

function marcarEtiquetaComoErro(id, mensagemErro) {
  return requisicaoSupabase(`/solicitacoes_etiqueta?id=eq.${id}`, "PATCH", {
    status: "erro",
    erro: mensagemErro,
  });
}

// Gera o PNG do código de barras (CODE128, com o número legível embaixo
// das barras — mesma leitura que o leitor usa no PDV Eventos), já girado
// 90° (sentido horário) pra ler no mesmo sentido do adesivo físico (pedido
// do usuário, 2026-08-14). Usa a opção nativa `rotate` do bwip-js em vez
// de girar "na mão" no PDF — a 1ª tentativa (girar no PDFKit, trocando as
// dimensões do `fit`) saiu correta na rotação mas minúscula, porque o
// código de barras (naturalmente largo e baixo) não preenchia a caixa
// alta e estreita depois de girado; `width`/`height` aqui são medidos
// ANTES do giro (a largura de 18mm vira o comprimento da etiqueta depois
// de girado, a altura de 4.5mm vira a largura), então o bwip-js já
// desenha maximizando o módulo pro espaço real disponível.
function gerarPngCodigoBarras(codigoInterno) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text: codigoInterno,
        includetext: true,
        textxalign: "center",
        scale: 5,
        height: 4.5,
        width: 18,
        rotate: "R",
      },
      (erro, png) => (erro ? reject(erro) : resolve(png)),
    );
  });
}

function construirPdfEtiqueta(png) {
  const larguraPt = ETIQUETA_LARGURA_MM * MM_PARA_PT;
  const alturaPt = ETIQUETA_ALTURA_MM * MM_PARA_PT;

  return new Promise((resolve, reject) => {
    // Página 21x7mm (bate com o papel de etiqueta calibrado no driver
    // Windows) — o PNG já vem girado e dimensionado do bwip-js, então só
    // precisa centralizar/escalar sem distorcer.
    const doc = new PDFDocument({ size: [larguraPt, alturaPt], margin: 0 });
    const pedacos = [];
    doc.on("data", (pedaco) => pedacos.push(pedaco));
    doc.on("end", () => resolve(Buffer.concat(pedacos)));
    doc.on("error", reject);
    doc.image(png, 0, 0, { fit: [larguraPt, alturaPt], align: "center", valign: "center" });
    doc.end();
  });
}

async function imprimirEtiqueta(codigoInterno) {
  const png = await gerarPngCodigoBarras(codigoInterno);
  const pdf = await construirPdfEtiqueta(png);

  // Debug temporário (2026-08-17) — depois de um teste sair com várias
  // etiquetas em branco (nenhuma impressa), salva sempre uma cópia fixa no
  // Desktop pra dar pra abrir num leitor de PDF normal e ver se o
  // problema é na geração do conteúdo (bwip-js/pdfkit) ou no envio pra
  // impressora (pdf-to-printer/driver). Sobrescreve a cada tentativa —
  // remover esse bloco depois que o problema for resolvido.
  try {
    fs.writeFileSync(path.join(os.homedir(), "Desktop", "etiqueta-debug.pdf"), pdf);
  } catch {
    // não deve impedir a impressão de verdade se essa gravação de debug falhar
  }

  const arquivoTemp = path.join(os.tmpdir(), `etiqueta-${Date.now()}.pdf`);
  fs.writeFileSync(arquivoTemp, pdf);
  try {
    // scale: "noscale" — sem isso, o pdf-to-printer (via SumatraPDF) usa
    // um ajuste de página padrão pensado pra impressora normal (A4/carta),
    // que não faz sentido pra um PDF já do tamanho exato da etiqueta
    // (21x7mm); é a opção que a própria lib recomenda pra impressora de
    // etiqueta (achado de code review, 2026-08-17, depois de um teste
    // sair com a etiqueta em branco apesar do PDF gerado estar correto —
    // confirmado abrindo o etiqueta-debug.pdf salvo pelo bloco acima).
    await imprimirArquivoNaImpressora(arquivoTemp, {
      printer: IMPRESSORA_ETIQUETA,
      silent: true,
      scale: "noscale",
    });
  } finally {
    fs.unlink(arquivoTemp, () => {}); // limpeza best-effort, não deve derrubar o fluxo se falhar
  }
}

async function processarEtiquetasPendentes() {
  let pendentes;
  try {
    pendentes = await buscarEtiquetasPendentes();
  } catch (erro) {
    console.error("Erro ao buscar etiquetas pendentes:", erro.message);
    return;
  }

  for (const solicitacao of pendentes) {
    try {
      await imprimirEtiqueta(solicitacao.codigo_interno);
      await marcarEtiquetaComoImpressa(solicitacao.id);
      console.log(`Etiqueta impressa: solicitação ${solicitacao.id} (código ${solicitacao.codigo_interno})`);
    } catch (erro) {
      const mensagem = String((erro && erro.message) || erro);
      console.error(`Erro ao imprimir etiqueta ${solicitacao.id}:`, mensagem);
      try {
        await marcarEtiquetaComoErro(solicitacao.id, mensagem);
      } catch (erroAoMarcar) {
        console.error(`Erro ao marcar etiqueta ${solicitacao.id} como erro:`, erroAoMarcar.message);
      }
    }
  }
}

// Última rede de segurança — um processo que precisa ficar de pé 24h/dia
// numa loja não pode morrer silenciosamente por uma exceção que escapou de
// algum ponto do loop; loga e segue vivo em vez de derrubar o processo.
// Cobre os dois jeitos de um erro escapar: síncrono (uncaughtException) e
// uma Promise rejeitada sem .catch (unhandledRejection) — a partir do
// Node 15 esse segundo caso derruba o processo por padrão se não for
// tratado, o que seria exatamente o "morrer silenciosamente" que isso aqui
// existe pra evitar.
process.on("uncaughtException", (erro) => {
  console.error("Erro não tratado (agente continua rodando):", erro);
});
process.on("unhandledRejection", (erro) => {
  console.error("Promise rejeitada sem tratamento (agente continua rodando):", erro);
});

async function loopPrincipal() {
  // Em paralelo, não sequencial — cupom (ELGIN) e etiqueta (Argox) são
  // filas/impressoras independentes; esperar uma terminar pra só então
  // checar a outra atrasaria a confirmação de etiqueta sempre que o cupom
  // estiver ocupado imprimindo várias vendas seguidas (achado de code
  // review, 2026-08-14). Isolado com .catch pra um erro na etiqueta
  // (recurso novo) nunca derrubar o polling do cupom (em produção há
  // semanas) — e vice-versa.
  await Promise.all([
    processarPendentes().catch((erro) => console.error("Erro inesperado ao processar cupons:", erro)),
    etiquetaDisponivel
      ? processarEtiquetasPendentes().catch((erro) => console.error("Erro inesperado ao processar etiquetas:", erro))
      : Promise.resolve(),
  ]);
  setTimeout(loopPrincipal, INTERVALO_POLLING_MS);
}

console.log(
  `Print-agent Trolesi ERP rodando — checando solicitações a cada ${INTERVALO_POLLING_MS}ms (impressora: \\\\${MAQUINA}\\${COMPARTILHAMENTO_IMPRESSORA})` +
    (etiquetaDisponivel ? ` + etiqueta (${IMPRESSORA_ETIQUETA})` : " (etiqueta desativada, ver aviso acima)"),
);
loopPrincipal();
