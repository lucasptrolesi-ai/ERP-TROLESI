"use server";

import { GoogleGenAI } from "@google/genai";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, normalizarCampo } from "./erros";
import type { AnaliseIaProduto, ProdutoSemelhante, TipoImagemProduto } from "@/lib/types";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Supabase = Awaited<ReturnType<typeof createClient>>;

type FotoEntrada = {
  tipo: TipoImagemProduto;
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

// Alinhado às colunas que já existem em `produtos` desde a migration
// 20260720000004 (documento mestre) — a IA preenche o que já existe, não
// inventa colunas paralelas. `tipo_banho`/`tamanho` e os booleanos
// `tem_pedra`/`tem_perola` são os nomes reais das colunas.
const ANALISE_JSON_SCHEMA = {
  type: "object",
  properties: {
    nome: { type: "string" },
    categoria: { type: "string" },
    subcategoria: { type: ["string", "null"] },
    material: { type: ["string", "null"] },
    cor: { type: ["string", "null"] },
    tipo_banho: { type: ["string", "null"] },
    tem_pedra: { type: "boolean" },
    tem_perola: { type: "boolean" },
    tamanho: { type: ["string", "null"] },
    colecao: { type: ["string", "null"] },
    descricao: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: [
    "nome",
    "categoria",
    "subcategoria",
    "material",
    "cor",
    "tipo_banho",
    "tem_pedra",
    "tem_perola",
    "tamanho",
    "colecao",
    "descricao",
    "tags",
  ],
  additionalProperties: false,
} as const;

/** Etapas 2 e 3 do Vision AI: manda as fotos pra IA e volta com os campos já sugeridos. */
export async function analisarFotosProduto(
  fotos: FotoEntrada[],
): Promise<{ erro?: string; resultado?: AnaliseIaProduto }> {
  if (fotos.length === 0) return { erro: "Envie ao menos a foto da frente." };

  const supabase = await createClient();

  const [{ data: produtosExistentes }, { data: correcoesRecentes }] = await Promise.all([
    supabase.from("produtos").select("categoria, subcategoria").limit(200),
    supabase
      .from("produto_ia_correcoes")
      .select("campo, valor_sugerido, valor_corrigido")
      .order("criado_em", { ascending: false })
      .limit(20),
  ]);

  const categorias = Array.from(new Set((produtosExistentes ?? []).map((p) => p.categoria))).slice(0, 40);
  const subcategorias = Array.from(
    new Set((produtosExistentes ?? []).map((p) => p.subcategoria).filter((s): s is string => Boolean(s))),
  ).slice(0, 40);

  // Últimas correções de operadores viram exemplos few-shot — é assim que a IA
  // "aprende" sem precisar de treinamento/fine-tuning de modelo nenhum.
  const exemplosCorrecao = (correcoesRecentes ?? [])
    .map((c) => `- Campo "${c.campo}": a IA sugeriu "${c.valor_sugerido ?? "(vazio)"}", o correto era "${c.valor_corrigido}".`)
    .join("\n");

  const system = [
    "Você é um especialista em semijoias que analisa fotos de peças para o cadastro de produtos de uma loja chamada Trolesi.",
    `Categorias já usadas pela loja: ${categorias.join(", ") || "nenhuma ainda"}.`,
    `Subcategorias já usadas: ${subcategorias.join(", ") || "nenhuma ainda"}.`,
    "Prefira reaproveitar essas categorias/subcategorias quando a peça se encaixar; só crie uma nova se nenhuma servir.",
    exemplosCorrecao
      ? `Correções recentes feitas por operadores humanos — não repita esses erros:\n${exemplosCorrecao}`
      : "",
    "Responda apenas com o que for observável nas fotos. Se não der pra identificar um campo de texto com confiança, use null nesse campo. tem_pedra/tem_perola só são true se der pra ver claramente na foto.",
  ]
    .filter(Boolean)
    .join("\n");

  let texto: string | undefined;
  try {
    const response = await genai.models.generateContent({
      model: process.env.GEMINI_MODEL_VISION ?? "gemini-3.1-flash-lite",
      contents: [
        {
          role: "user",
          parts: [
            ...fotos.map((foto) => ({
              inlineData: { mimeType: foto.mediaType, data: foto.base64 },
            })),
            { text: "Analise estas fotos de uma peça de semijoia e preencha os campos pedidos." },
          ],
        },
      ],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: ANALISE_JSON_SCHEMA,
      },
    });
    texto = response.text;
  } catch {
    return { erro: "Não foi possível falar com a IA agora. Tente novamente em instantes." };
  }

  if (!texto) return { erro: "A IA não retornou um resultado válido. Tente outras fotos." };

  try {
    return { resultado: JSON.parse(texto) as AnaliseIaProduto };
  } catch {
    return { erro: "A IA não retornou um resultado válido." };
  }
}

/** Etapa 4: antiduplicação por metadados (categoria/material/cor/tags) — não é comparação visual. */
export async function buscarProdutosSemelhantes(analise: AnaliseIaProduto): Promise<ProdutoSemelhante[]> {
  const supabase = await createClient();
  const { data: produtos } = await supabase.from("produtos").select("*").eq("ativo", true);
  if (!produtos) return [];

  const tagsAnalise = new Set((analise.tags ?? []).map((t) => t.toLowerCase()));

  const pontuados = produtos.map((p) => {
    let pontos = 0;
    const totalPossivel = 8;

    if (p.categoria?.toLowerCase() === analise.categoria?.toLowerCase()) pontos += 3;
    if (analise.subcategoria && p.subcategoria?.toLowerCase() === analise.subcategoria.toLowerCase()) pontos += 2;
    if (analise.material && p.material?.toLowerCase() === analise.material.toLowerCase()) pontos += 1;
    if (analise.cor && p.cor?.toLowerCase() === analise.cor.toLowerCase()) pontos += 1;

    if (tagsAnalise.size > 0) {
      const tagsProduto = new Set((p.tags ?? ([] as string[])).map((t: string) => t.toLowerCase()));
      const interseccao = Array.from(tagsAnalise).filter((t) => tagsProduto.has(t)).length;
      pontos += (interseccao / tagsAnalise.size) * 1;
    }

    return { ...p, pontuacao: Math.round((pontos / totalPossivel) * 100) };
  });

  return pontuados
    .filter((p) => p.pontuacao >= 60)
    .sort((a, b) => b.pontuacao - a.pontuacao)
    .slice(0, 5);
}

function gerarCodigoInterno(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `TR-${n}`;
}

async function gerarCodigoInternoUnico(supabase: Supabase): Promise<string> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigoInterno();
    const { data } = await supabase.from("produtos").select("id").eq("codigo_interno", codigo).maybeSingle();
    if (!data) return codigo;
  }
  throw new Error("Não foi possível gerar um código interno único.");
}

type Correcao = { campo: string; valor_sugerido: string | null; valor_corrigido: string };

const MEDIA_TYPES_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Etapas 5 e 7: grava o produto, as fotos, o código interno gerado e as
 * correções do operador, numa chamada só. O código de barras impresso na
 * etiqueta (Etapa 7) é o próprio `codigo_interno` codificado como CODE128 —
 * não existe uma geração separada pra coluna `codigo_barras`, que já existe
 * no schema com outro propósito (código real do fornecedor, digitado à mão).
 */
export async function salvarProdutoComIA(dados: {
  analise: AnaliseIaProduto;
  codigoPeca: number;
  imagens: FotoEntrada[];
  correcoes: Correcao[];
}): Promise<{
  erro?: string;
  produtoId?: string;
  codigoInterno?: string;
  avisoFotos?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: "Sessão expirada. Faça login novamente." };

  const codigoInterno = await gerarCodigoInternoUnico(supabase);

  const { analise } = dados;
  const { data: produto, error } = await supabase
    .from("produtos")
    .insert({
      nome: normalizarCampo(analise.nome, { caixaAlta: true }),
      categoria: normalizarCampo(analise.categoria, { caixaAlta: true }),
      subcategoria: normalizarCampo(analise.subcategoria, { caixaAlta: true }),
      material: normalizarCampo(analise.material, { caixaAlta: true }),
      cor: normalizarCampo(analise.cor, { caixaAlta: true }),
      tipo_banho: normalizarCampo(analise.tipo_banho, { caixaAlta: true }),
      tem_pedra: analise.tem_pedra,
      tem_perola: analise.tem_perola,
      tamanho: normalizarCampo(analise.tamanho, { caixaAlta: true }),
      colecao: normalizarCampo(analise.colecao, { caixaAlta: true }),
      descricao: normalizarCampo(analise.descricao, { caixaAlta: true }),
      tags: analise.tags,
      codigo_peca: Math.max(0, dados.codigoPeca),
      codigo_interno: codigoInterno,
    })
    .select("id")
    .single();

  if (error || !produto) return { erro: mensagemErroSalvar(error!, "código interno") };

  let fotosEnviadas = 0;
  // Distinto de "upload falhou" (contemplado desde sempre): o arquivo pode
  // subir com sucesso na Storage e ainda assim o registro em
  // `produto_imagens`/`foto_url` falhar (RLS, erro transitório) — sem essa
  // flag, a foto fica órfã na Storage e o cadastro reporta sucesso sem
  // avisar nada (achado de code review, 2026-08-11).
  let houveFalhaPosUpload = false;
  for (const imagem of dados.imagens) {
    if (!MEDIA_TYPES_PERMITIDOS.has(imagem.mediaType)) continue;

    const caminho = `${produto.id}/${imagem.tipo}-${Date.now()}.jpg`;
    const bytes = Buffer.from(imagem.base64, "base64");
    const { error: erroUpload } = await supabase.storage
      .from("produtos-fotos")
      .upload(caminho, bytes, { contentType: imagem.mediaType });
    if (erroUpload) continue; // uma foto falhar não deve derrubar o cadastro inteiro

    const { error: erroImagem } = await supabase
      .from("produto_imagens")
      .insert({ produto_id: produto.id, tipo: imagem.tipo, storage_path: caminho });
    if (erroImagem) {
      houveFalhaPosUpload = true;
      continue;
    }

    if (imagem.tipo === "frente") {
      const { data: url } = supabase.storage.from("produtos-fotos").getPublicUrl(caminho);
      const { error: erroFotoUrl } = await supabase
        .from("produtos")
        .update({ foto_url: url.publicUrl })
        .eq("id", produto.id);
      if (erroFotoUrl) {
        houveFalhaPosUpload = true;
        continue;
      }
    }

    fotosEnviadas++;
  }

  const avisoFotos =
    dados.imagens.length > 0 && (fotosEnviadas === 0 || houveFalhaPosUpload)
      ? "O produto foi cadastrado, mas uma ou mais fotos não foram salvas corretamente — confira e tente anexar de novo pela tela de Estoque."
      : undefined;

  if (dados.correcoes.length > 0) {
    await supabase.from("produto_ia_correcoes").insert(
      dados.correcoes.map((c) => ({
        produto_id: produto.id,
        campo: c.campo,
        valor_sugerido: c.valor_sugerido,
        valor_corrigido: c.valor_corrigido,
        criado_por: user.id,
      })),
    );
  }

  revalidatePath("/estoque");
  revalidatePath("/pedidos");
  return { produtoId: produto.id, codigoInterno, avisoFotos };
}
