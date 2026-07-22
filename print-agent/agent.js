// Print-agent local do ERP Trolesi — roda só nesse PC (o mesmo onde a
// impressora térmica está instalada e compartilhada no Windows). Recebe o
// conteúdo do cupom por HTTP do navegador (localhost, mesma máquina) e manda
// direto pra fila de impressão em modo RAW (ESC/POS), sem passar pelo
// desenho/rasterização de página do navegador — é isso que dá a qualidade
// nítida (igual a de um sistema nativo como o GMax) em vez do texto
// borrado que sai ao imprimir uma página HTML numa impressora térmica.
//
// Como funciona (testado na prática, ver DECISIONS.md):
// 1. Monta os comandos ESC/POS (negrito, alinhamento, corte) num buffer.
// 2. Grava o buffer num arquivo temporário.
// 3. Copia o arquivo (modo binário) pra fila compartilhada da impressora
//    no Windows (\\<MAQUINA>\<COMPARTILHAMENTO>) — isso entrega os bytes
//    direto pro spooler em modo RAW, sem reprocessar.
//
// Não usa nenhuma dependência de npm de propósito — só módulos nativos do
// Node — pra não exigir "npm install" na hora de configurar numa loja.
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const PORTA = Number(process.env.PORTA_PRINT_AGENT) || 41022;
const COMPARTILHAMENTO_IMPRESSORA = process.env.IMPRESSORA_COMPARTILHAMENTO || "ELGIN i8";
const MAQUINA = os.hostname();
const COLUNAS = 48; // confirmado na prática pra Elgin i8 58mm (48mm úteis)

const ORIGENS_PERMITIDAS = new Set([
  "https://erp-trolesi.vercel.app",
  "http://localhost:3000",
]);

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
      const esquerda = semAcento(linha.esquerda);
      const direita = semAcento(linha.direita);
      const cabe = esquerda.length + direita.length + 1 <= COLUNAS;
      const texto = cabe
        ? esquerda + " ".repeat(COLUNAS - esquerda.length - direita.length) + direita
        : `${esquerda.slice(0, Math.max(0, COLUNAS - direita.length - 1))} ${direita}`;
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

function aplicarCabecalhosCors(req, res) {
  const origem = req.headers.origin;
  if (origem && ORIGENS_PERMITIDAS.has(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    // Chrome trata um site público chamando um endereço loopback como
    // "Private Network Access" — sem esse cabeçalho no preflight, o
    // navegador bloqueia a chamada mesmo com CORS liberado.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

// Só decide se anexa cabeçalho CORS — não bastava pra bloquear de verdade
// (uma requisição "simples", sem preflight, chegava no handler de qualquer
// jeito). Chamado no início de cada rota que aceita escrita, não só no
// CORS: se veio um Origin e ele não está na lista, rejeita de propósito.
function origemPermitida(req) {
  const origem = req.headers.origin;
  return !origem || ORIGENS_PERMITIDAS.has(origem);
}

const servidor = http.createServer((req, res) => {
  aplicarCabecalhosCors(req, res);

  // Uma requisição que aborta no meio (ex: o cliente cancelou a impressão
  // ou a aba fechou) emite 'error' no stream — sem esse listener, isso
  // derrubava o processo inteiro (sem try/catch, é um evento não tratado,
  // não uma exceção síncrona), e o agente fica rodando sozinho, sem
  // ninguém pra reiniciar até alguém notar.
  req.on("error", () => {
    res.destroy();
  });

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, impressora: COMPARTILHAMENTO_IMPRESSORA, maquina: MAQUINA }));
    return;
  }

  if (req.method === "POST" && req.url === "/imprimir") {
    if (!origemPermitida(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, erro: "Origem não permitida" }));
      return;
    }
    let corpo = "";
    req.on("data", (pedaco) => {
      corpo += pedaco;
    });
    req.on("end", async () => {
      try {
        const dados = JSON.parse(corpo);
        const buffer = construirEscPos(Array.isArray(dados.linhas) ? dados.linhas : []);
        await enviarParaImpressora(buffer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (erro) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, erro: String(erro && erro.message ? erro.message : erro) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// Última rede de segurança — um processo que precisa ficar de pé 24h/dia
// numa loja não pode morrer silenciosamente por uma exceção que escapou de
// algum handler; loga e segue vivo em vez de derrubar o processo inteiro.
process.on("uncaughtException", (erro) => {
  console.error("Erro não tratado (agente continua rodando):", erro);
});

servidor.listen(PORTA, "127.0.0.1", () => {
  console.log(
    `Print-agent Trolesi ERP rodando em http://127.0.0.1:${PORTA} (impressora: \\\\${MAQUINA}\\${COMPARTILHAMENTO_IMPRESSORA})`,
  );
});
