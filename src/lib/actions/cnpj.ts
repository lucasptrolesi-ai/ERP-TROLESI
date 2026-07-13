"use server";

export type DadosCnpj = {
  nome: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  situacaoCadastral: string | null;
  dataAbertura: string | null;
  naturezaJuridica: string | null;
  porte: string | null;
  atividadePrincipal: string | null;
};

type RespostaBrasilApi = {
  razao_social?: string;
  nome_fantasia?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  email?: string;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  natureza_juridica?: string;
  porte?: string;
  cnae_fiscal_descricao?: string;
};

type RespostaReceitaWs = {
  status?: string;
  nome?: string;
  fantasia?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
  situacao?: string;
  abertura?: string;
  natureza_juridica?: string;
  porte?: string;
  atividade_principal?: { text?: string }[];
};

const CABECALHOS = { "User-Agent": "TrolesiERP/1.0" };

/** "19/06/2026" -> "2026-06-19" (formato de <input type="date">/coluna date). */
function dataBrParaIso(data: string | undefined): string | null {
  if (!data) return null;
  const [dia, mes, ano] = data.split("/");
  if (!dia || !mes || !ano) return null;
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

async function buscarNaBrasilApi(cnpj: string): Promise<DadosCnpj | null> {
  const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: CABECALHOS,
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) return null;

  const json: RespostaBrasilApi = await resposta.json();
  return {
    nome: json.razao_social || json.nome_fantasia || "",
    razaoSocial: json.razao_social || null,
    nomeFantasia: json.nome_fantasia || null,
    telefone: json.ddd_telefone_1 || null,
    email: json.email || null,
    endereco: [json.logradouro, json.numero].filter(Boolean).join(", ") || null,
    bairro: json.bairro || null,
    cidade: json.municipio || null,
    uf: json.uf || null,
    cep: json.cep || null,
    situacaoCadastral: json.descricao_situacao_cadastral || null,
    dataAbertura: json.data_inicio_atividade || null,
    naturezaJuridica: json.natureza_juridica || null,
    porte: json.porte || null,
    atividadePrincipal: json.cnae_fiscal_descricao || null,
  };
}

// Fallback: a BrasilAPI roda sobre um dump periódico da Receita Federal e
// atrasa pra empresas/MEI abertos recentemente. A ReceitaWS consulta uma
// base mais atual, mas tem limite de taxa mais apertado — por isso só entra
// quando a primeira fonte não encontra nada, não como busca primária.
async function buscarNaReceitaWs(cnpj: string): Promise<DadosCnpj | null> {
  const resposta = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
    headers: CABECALHOS,
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) return null;

  const json: RespostaReceitaWs = await resposta.json();
  if (json.status === "ERROR") return null;

  return {
    nome: json.nome || json.fantasia || "",
    razaoSocial: json.nome || null,
    nomeFantasia: json.fantasia || null,
    telefone: json.telefone || null,
    email: json.email || null,
    endereco: [json.logradouro, json.numero].filter(Boolean).join(", ") || null,
    bairro: json.bairro || null,
    cidade: json.municipio || null,
    uf: json.uf || null,
    cep: json.cep?.replace(/\D/g, "") || null,
    situacaoCadastral: json.situacao || null,
    dataAbertura: dataBrParaIso(json.abertura),
    naturezaJuridica: json.natureza_juridica || null,
    porte: json.porte || null,
    atividadePrincipal: json.atividade_principal?.[0]?.text || null,
  };
}

export async function buscarCnpj(cnpj: string): Promise<{ dados?: DadosCnpj; erro?: string }> {
  const limpo = cnpj.replace(/\D/g, "");
  if (limpo.length !== 14) {
    return { erro: "Informe um CNPJ válido (14 dígitos) para buscar." };
  }

  // Cada fonte falha (timeout, rede fora) de forma independente — se a
  // BrasilAPI travar, ainda vale tentar a ReceitaWS, não só quando ela
  // responde "não encontrado". Só reporta "não encontrado" se as duas
  // fontes realmente responderam vazio, não quando as duas caíram.
  let houveFalhaDeRede = false;

  const daBrasilApi = await buscarNaBrasilApi(limpo).catch(() => {
    houveFalhaDeRede = true;
    return null;
  });
  if (daBrasilApi) return { dados: daBrasilApi };

  const daReceitaWs = await buscarNaReceitaWs(limpo).catch(() => {
    houveFalhaDeRede = true;
    return null;
  });
  if (daReceitaWs) return { dados: daReceitaWs };

  return houveFalhaDeRede
    ? { erro: "Não foi possível consultar o CNPJ agora. Tente novamente." }
    : { erro: "CNPJ não encontrado." };
}
