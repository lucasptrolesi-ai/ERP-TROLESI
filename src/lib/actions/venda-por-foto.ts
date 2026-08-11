"use server";

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import type { AnaliseNotinha } from "@/lib/types";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type FotoEntrada = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

// Mesmo allowlist de vision-ai.ts — defesa em profundidade mesmo o tipo já
// restringir os valores possíveis (comprimirImagem no cliente sempre emite
// "image/jpeg", mas o servidor não deveria confiar cegamente nisso).
const MEDIA_TYPES_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

// Dicionário de gírias da loja pra nome comercial — descoberto conferindo
// notinhas reais com o usuário (DECISIONS.md, 2026-08-10). Só 3 termos por
// enquanto ("por hora não temos um estoque geral" — resposta do usuário
// quando perguntado sobre variantes de Corrente); estender esta lista
// conforme aparecerem notinhas com gírias novas, não precisa de tabela no
// banco pra 3 entradas.
const GLOSSARIO_GIRIAS = [
  { giria: "fornitura", comercial: "Embalagem" },
  { giria: "escapulário / escapulária", comercial: "Corrente" },
  { giria: "fol", comercial: "folheado a ouro (atributo, não é palavra separada do nome)" },
];

const ANALISE_JSON_SCHEMA = {
  type: "object",
  properties: {
    cliente: { type: ["string", "null"] },
    data: { type: ["string", "null"] },
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          codigo_peca: { type: ["number", "null"] },
          multiplicador: { type: ["number", "null"] },
          valor_linha: { type: ["number", "null"] },
        },
        required: ["descricao", "codigo_peca", "multiplicador", "valor_linha"],
        additionalProperties: false,
      },
    },
    total: { type: ["number", "null"] },
    pagamentos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          forma: { type: "string" },
          valor: { type: "number" },
        },
        required: ["forma", "valor"],
        additionalProperties: false,
      },
    },
    campos_incertos: { type: "array", items: { type: "string" } },
  },
  required: ["cliente", "data", "itens", "total", "pagamentos", "campos_incertos"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "Você lê notinhas de venda manuscritas de uma loja de semijoias chamada Trolesi e extrai os dados pra lançar o pedido no sistema.",
  "",
  "IMPORTANTE — o cabeçalho pré-impresso do papel (Quant./Descrição Mercadoria/Ref./Unit./Total) NÃO significa o que está escrito nele. Na prática, cada linha de item é lida assim:",
  "- A coluna que parece 'Quant.' é o CÓDIGO DA PEÇA (um número, geralmente com uma casa decimal, ex: 24,0). Vai no campo codigo_peca.",
  "- A coluna 'Ref.' é o MULTIPLICADOR (ex: 2,8). Pode vir em branco — nesse caso, codigo_peca vem preenchido e multiplicador fica null.",
  "- A coluna 'Descrição Mercadoria' é o nome da peça, escrito em gíria interna da loja.",
  "- A coluna 'Total' da linha é o valor calculado (código × multiplicador) — leia como valor_linha se estiver escrito.",
  "",
  "Dicionário de gírias conhecidas — traduza a descrição pro nome comercial real sempre que reconhecer uma gíria; se não reconhecer, mantenha o texto exatamente como foi escrito:",
  ...GLOSSARIO_GIRIAS.map((g) => `- "${g.giria}" → ${g.comercial}`),
  "",
  "Formas de pagamento: leia como foram escritas (ex: 'crédito', 'pix', 'dinheiro', 'débito', 'promissória'). Pode haver mais de uma forma na mesma venda (pagamento dividido).",
  "",
  "Liste em campos_incertos o nome de qualquer campo que você preencheu com baixa confiança por causa de letra difícil de ler (ex: 'cliente', 'data', 'itens[0].descricao') — não invente valor pra esconder incerteza, é melhor marcar como incerto do que errar silenciosamente.",
  "Se um campo realmente não estiver na nota, use null (ou array vazio) em vez de inventar.",
].join("\n");

/** Lê a foto da notinha manuscrita e devolve os campos sugeridos pro pedido — revisão humana obrigatória antes de qualquer gravação (nenhuma chamada aqui grava no banco). */
export async function analisarNotinha(foto: FotoEntrada): Promise<{ erro?: string; resultado?: AnaliseNotinha }> {
  let texto: string | undefined;
  try {
    const response = await genai.models.generateContent({
      model: process.env.GEMINI_MODEL_VISION ?? "gemini-3.1-flash-lite",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: foto.mediaType, data: foto.base64 } },
            { text: "Leia esta notinha de venda manuscrita e preencha os campos pedidos." },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: ANALISE_JSON_SCHEMA,
      },
    });
    texto = response.text;
  } catch {
    return { erro: "Não foi possível falar com a IA agora. Tente novamente em instantes." };
  }

  if (!texto) return { erro: "A IA não retornou um resultado válido. Tente outra foto." };

  try {
    return { resultado: JSON.parse(texto) as AnaliseNotinha };
  } catch {
    return { erro: "A IA não retornou um resultado válido." };
  }
}

/** Sobe a foto original da notinha pro Storage e vincula ao pedido já criado — puramente auditoria, uma foto falhar aqui não deve invalidar a venda (já foi gravada por `criarPedido`). */
export async function anexarFotoNotinha(
  pedidoId: string,
  foto: FotoEntrada,
): Promise<{ erro?: string }> {
  if (!MEDIA_TYPES_PERMITIDOS.has(foto.mediaType)) return { erro: "Tipo de imagem não suportado." };

  const supabase = await createClient();
  const caminho = `${pedidoId}/notinha-${Date.now()}.jpg`;
  const bytes = Buffer.from(foto.base64, "base64");

  const { error: erroUpload } = await supabase.storage
    .from("pedidos-notas-fotos")
    .upload(caminho, bytes, { contentType: foto.mediaType });
  if (erroUpload) return { erro: "Pedido lançado, mas não foi possível salvar a foto da notinha." };

  const { error: erroUpdate } = await supabase.from("pedidos").update({ notinha_foto_path: caminho }).eq("id", pedidoId);
  if (erroUpdate) return { erro: "Pedido lançado, mas não foi possível vincular a foto da notinha." };

  return {};
}
