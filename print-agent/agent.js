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
"use strict";

const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

carregarEnvLocal();

const COMPARTILHAMENTO_IMPRESSORA = process.env.IMPRESSORA_COMPARTILHAMENTO || "ELGIN i8";
const MAQUINA = os.hostname();
const COLUNAS = 48; // confirmado na prática pra Elgin i8 58mm (48mm úteis)
const INTERVALO_POLLING_MS = Number(process.env.INTERVALO_POLLING_MS) || 2000;

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
    "/solicitacoes_impressao?status=eq.pendente&order=criado_em.asc&limit=5&select=id,via,linhas",
    "GET",
  );
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
  await processarPendentes();
  setTimeout(loopPrincipal, INTERVALO_POLLING_MS);
}

console.log(
  `Print-agent Trolesi ERP rodando — checando solicitações a cada ${INTERVALO_POLLING_MS}ms (impressora: \\\\${MAQUINA}\\${COMPARTILHAMENTO_IMPRESSORA})`,
);
loopPrincipal();
