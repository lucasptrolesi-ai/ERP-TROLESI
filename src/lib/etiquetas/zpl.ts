// Motor genérico de etiqueta (modelos com elementos arrastáveis — "Módulo Etiquetas", 2026-10-15) —
// funções puras, sem I/O. Gera ZPL a partir de um `ModeloEtiqueta` (tamanho, DPI, velocidade, escuro,
// elementos) + os dados reais de uma peça. Troca a geração fixa de 1 template (o que existia antes,
// só pra "Joia rabicho") por uma genérica, movida pro app (antes era parcialmente duplicada no
// print-agent) — ver DECISIONS.md "Módulo Etiquetas" pra essa mudança de arquitetura: o print-agent
// agora só ENVIA o ZPL já pronto (`solicitacoes_etiqueta.zpl`), não monta mais nada, o mesmo espírito
// do modo "rede" do cupom (bytes crus, sem lógica de negócio no agente).
import QRCode from "qrcode";
import { formatarMoeda } from "@/lib/formatar-moeda";

// 203dpi "de fábrica" da Elgin L42 Pro Full é, na prática, EXATAMENTE 8 dots/mm (203,2dpi — a folha de
// especificação arredonda pra "203dpi", mas 8 dots/mm × 25,4mm/polegada = 203,2). Usar 203 reto na
// conversão mm→dots dá 759 pra 95mm (95×203/25,4 = 759,25…), mas o ZPL aprovado e validado fisicamente
// na etiqueta real usa 760 (^PW760) — confirmado por reprodução: só bate com dpi=203.2 (95×203,2/25,4 =
// 95×8 = 760 exato). Por isso o modelo semente ("Joia rabicho") grava `dpi: 203.2`, não 203 — não é
// erro de digitação. Doc de referência: ver DECISIONS.md.
export function mmParaDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

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
export function gerarBitmapQrGfa(texto: string, escalaDots = 3, correcao: "L" | "M" | "Q" | "H" = "M"): string {
  const qr = QRCode.create(texto, { errorCorrectionLevel: correcao });
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

// --- Modelo de dados (schema vivo em etiqueta_modelos.elementos, jsonb) -------------------------

export type Alinhamento = "esquerda" | "centro" | "direita";
export type CampoDado = "preco_venda" | "nome" | "codigo" | "atributos" | "categoria" | "localizacao" | "data_hoje";
export type FormatoConteudo = "moeda" | "texto" | "maiusculas";
export type TipoElemento = "texto" | "qr" | "barcode" | "linha" | "retangulo" | "imagem";

export type ConteudoElemento = {
  origem: "fixo" | "campo";
  texto?: string;
  campo?: CampoDado;
  campoSeVazio?: CampoDado;
  prefixo?: string;
  formato?: FormatoConteudo;
};

export type FonteElemento = { altura_mm: number; largura_mm: number; encolherSeNaoCouber: boolean };

export type ElementoEtiqueta = {
  id: string;
  nome: string;
  tipo: TipoElemento;
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  conteudo?: ConteudoElemento;
  fonte?: FonteElemento;
  alinhamento?: Alinhamento;
  maxCaracteres?: number;
  qr?: { modulo_dots: number; correcao: "L" | "M" | "Q" | "H" };
  barcode?: { simbologia: "code128" | "itf"; modulo_dots: number; razao?: number; altura_mm: number };
  linha?: { espessura_mm: number };
  imagem?: { asset_url: string; gfa_cache?: string };
};

export type AreaImprimivel = { x_mm: number; y_mm: number; w_mm: number; h_mm: number };

export type ModeloEtiqueta = {
  // nome não é usado pelo motor (não entra no ZPL) — só carregado aqui pra quem busca a linha do
  // banco não precisar de um segundo tipo só pra exibir "Joia rabicho" na tela.
  nome: string;
  largura_mm: number;
  altura_mm: number;
  dpi: number;
  velocidade: number;
  escuro: number;
  elementos: ElementoEtiqueta[];
};

export type DadosPeca = {
  preco_venda: number;
  nome: string;
  codigo: string;
  atributos: string;
  categoria: string;
  localizacao: string;
};

function valorBrutoDoCampo(campo: CampoDado, dados: DadosPeca): string {
  switch (campo) {
    case "preco_venda":
      return String(dados.preco_venda);
    case "nome":
      return dados.nome;
    case "codigo":
      return dados.codigo;
    case "atributos":
      return dados.atributos;
    case "categoria":
      return dados.categoria;
    case "localizacao":
      return dados.localizacao;
    case "data_hoje":
      return new Date().toLocaleDateString("pt-BR");
  }
}

function aplicarFormato(valor: string, formato: FormatoConteudo | undefined): string {
  if (formato === "moeda") return formatarMoeda(Number(valor.replace(",", ".")) || 0);
  if (formato === "maiusculas") return valor.toUpperCase();
  return valor;
}

/** Resolve o texto final de um elemento (fixo ou ligado a um campo da peça, com fallback, prefixo e
 * formato) — truncamento em `maxCaracteres` acontece ANTES do formato/prefixo (limita o dado, não o
 * texto decorativo em volta). Sanitização de ^~\\ fica por conta de quem usa o resultado como ^FD
 * (texto/barcode) — o QR não passa por ^FD, não precisa. */
export function resolverConteudo(conteudo: ConteudoElemento | undefined, dados: DadosPeca, maxCaracteres?: number): string {
  if (!conteudo) return "";
  let bruto: string;
  if (conteudo.origem === "fixo") {
    bruto = conteudo.texto ?? "";
  } else {
    bruto = conteudo.campo ? valorBrutoDoCampo(conteudo.campo, dados) : "";
    if (bruto.trim() === "" && conteudo.campoSeVazio) {
      bruto = valorBrutoDoCampo(conteudo.campoSeVazio, dados);
    }
  }
  if (maxCaracteres) bruto = bruto.slice(0, maxCaracteres);
  const formatado = aplicarFormato(bruto, conteudo.formato);
  return `${conteudo.prefixo ?? ""}${formatado}`;
}

const JUSTIFICACAO_ZPL: Record<Alinhamento, string> = { esquerda: "L", centro: "C", direita: "R" };
const LARGURA_FONTE_MINIMA_DOTS = 4;

/** "encolherSeNaoCouber": reduz altura/largura da fonte (mantendo a proporção) até o texto caber na
 * largura do elemento — heurística determinística (largura do caractere × quantidade de caracteres),
 * não a métrica real da fonte ^A0 da impressora (que varia por caractere) — é a mesma aproximação já
 * usada/testada no resto do projeto pra decisão de layout, não pixel-perfeito, só previsível. */
function ajustarFonte(texto: string, wDots: number, fonte: FonteElemento, dpi: number): { alturaDots: number; larguraDots: number } {
  let alturaDots = mmParaDots(fonte.altura_mm, dpi);
  let larguraDots = mmParaDots(fonte.largura_mm, dpi);
  if (!fonte.encolherSeNaoCouber) return { alturaDots, larguraDots };
  while (texto.length * larguraDots > wDots && larguraDots > LARGURA_FONTE_MINIMA_DOTS && alturaDots > LARGURA_FONTE_MINIMA_DOTS) {
    larguraDots -= 1;
    alturaDots -= 1;
  }
  return { alturaDots, larguraDots };
}

// `override`, quando presente, substitui a resolução normal (fixo/campo) — é como o admin edita o
// texto na tela "Imprimir etiqueta" sem precisar mudar o modelo em si (o valor editado vale só pra
// essa impressão). Ainda passa por maxCaracteres/sanitização, igual ao texto resolvido normalmente.
function textoDoElemento(el: ElementoEtiqueta, dados: DadosPeca, override: string | undefined): string {
  return override !== undefined ? (el.maxCaracteres ? override.slice(0, el.maxCaracteres) : override) : resolverConteudo(el.conteudo, dados, el.maxCaracteres);
}

function elementoTextoParaZpl(el: ElementoEtiqueta, dados: DadosPeca, dpi: number, override: string | undefined): string {
  const texto = sanitizarCampoZpl(textoDoElemento(el, dados, override));
  const xDots = mmParaDots(el.x_mm, dpi);
  const yDots = mmParaDots(el.y_mm, dpi);
  const wDots = mmParaDots(el.w_mm, dpi);
  const fonte = el.fonte ?? { altura_mm: 2, largura_mm: 2, encolherSeNaoCouber: false };
  const { alturaDots, larguraDots } = ajustarFonte(texto, wDots, fonte, dpi);
  const alinhamento = el.alinhamento ?? "esquerda";
  // ^FB só entra quando precisa justificar dentro de uma largura (centro/direita) — texto à esquerda
  // já nasce alinhado no próprio ^FO, não precisa de bloco de campo (replica o ZPL aprovado à risca:
  // os elementos originais "SKU"/código, à esquerda, nunca tiveram ^FB).
  const bloco = alinhamento === "esquerda" ? "" : `^FB${wDots},1,0,${JUSTIFICACAO_ZPL[alinhamento]}`;
  return `^FO${xDots},${yDots}${bloco}^A0N,${alturaDots},${larguraDots}^FD${texto}^FS`;
}

function elementoQrParaZpl(el: ElementoEtiqueta, dados: DadosPeca, dpi: number, override: string | undefined): string {
  const texto = textoDoElemento(el, dados, override);
  const xDots = mmParaDots(el.x_mm, dpi);
  const yDots = mmParaDots(el.y_mm, dpi);
  const config = el.qr ?? { modulo_dots: 3, correcao: "M" as const };
  const gfa = gerarBitmapQrGfa(texto, config.modulo_dots, config.correcao);
  return `^FO${xDots},${yDots}^GFA,${gfa}^FS`;
}

function elementoBarcodeParaZpl(el: ElementoEtiqueta, dados: DadosPeca, dpi: number, override: string | undefined): string {
  const texto = sanitizarCampoZpl(textoDoElemento(el, dados, override));
  const xDots = mmParaDots(el.x_mm, dpi);
  const yDots = mmParaDots(el.y_mm, dpi);
  const config = el.barcode ?? { simbologia: "code128" as const, modulo_dots: 2, altura_mm: el.h_mm };
  const alturaDots = mmParaDots(config.altura_mm, dpi);
  const comando = config.simbologia === "itf" ? "^B2" : "^BC";
  if (config.simbologia === "itf" && !/^\d+$/.test(texto)) {
    throw new Error(`Código de barras ITF só aceita dígitos (elemento "${el.nome}")`);
  }
  if (config.simbologia === "itf" && texto.length % 2 !== 0) {
    throw new Error(`Código de barras ITF exige quantidade par de dígitos (elemento "${el.nome}")`);
  }
  return [`^BY${config.modulo_dots},${config.razao ?? 3},${alturaDots}`, `^FO${xDots},${yDots}${comando}N,${alturaDots},N,N,N^FD${texto}^FS`].join("\n");
}

function elementoLinhaOuRetanguloParaZpl(el: ElementoEtiqueta, dpi: number): string {
  const xDots = mmParaDots(el.x_mm, dpi);
  const yDots = mmParaDots(el.y_mm, dpi);
  const wDots = Math.max(1, mmParaDots(el.w_mm, dpi));
  const hDots = Math.max(1, mmParaDots(el.h_mm, dpi));
  const espessuraDots = Math.max(1, mmParaDots(el.linha?.espessura_mm ?? 0.3, dpi));
  return `^FO${xDots},${yDots}^GB${wDots},${hDots},${Math.min(espessuraDots, wDots, hDots)},B,0^FS`;
}

function elementoImagemParaZpl(el: ElementoEtiqueta, dpi: number): string {
  const xDots = mmParaDots(el.x_mm, dpi);
  const yDots = mmParaDots(el.y_mm, dpi);
  // A conversão pra bitmap 1 bit acontece no upload (editor), não aqui — este módulo só usa o cache
  // já pronto. Sem cache, o elemento não imprime nada (não quebra o resto da etiqueta).
  if (!el.imagem?.gfa_cache) return "";
  return `^FO${xDots},${yDots}^GFA,${el.imagem.gfa_cache}^FS`;
}

function elementoParaZpl(el: ElementoEtiqueta, dados: DadosPeca, dpi: number, override: string | undefined): string {
  switch (el.tipo) {
    case "texto":
      return elementoTextoParaZpl(el, dados, dpi, override);
    case "qr":
      return elementoQrParaZpl(el, dados, dpi, override);
    case "barcode":
      return elementoBarcodeParaZpl(el, dados, dpi, override);
    case "linha":
    case "retangulo":
      return elementoLinhaOuRetanguloParaZpl(el, dpi);
    case "imagem":
      return elementoImagemParaZpl(el, dpi);
  }
}

/** Gerador genérico: modelo (tamanho/DPI/velocidade/escuro/elementos) + dados reais de uma peça ->
 * ZPL completo, pronto pra imprimir. Pro modelo semente "Joia rabicho", com os dados de exemplo do
 * plano aprovado, o resultado é BYTE A BYTE idêntico ao template fixo validado fisicamente antes
 * deste motor existir (teste de snapshot em zpl.test.ts) — qualquer mudança aqui que quebre esse
 * teste precisa ser reimpressa e remedida na etiqueta real antes de seguir.
 *
 * `overrides` (opcional, por id de elemento): o que o admin edita na tela "Imprimir etiqueta" antes
 * de confirmar — vale só pra essa impressão, não muda o modelo salvo. */
export function modeloParaZpl(modelo: ModeloEtiqueta, dados: DadosPeca, quantidade: number, overrides?: Record<string, string>): string {
  const larguraDots = mmParaDots(modelo.largura_mm, modelo.dpi);
  const alturaDots = mmParaDots(modelo.altura_mm, modelo.dpi);
  const quantidadeValida = Math.max(1, Math.round(quantidade) || 1);

  const linhas = [
    "^XA",
    "^CI28",
    "^MTT",
    "^MNY",
    `^PR${modelo.velocidade},${modelo.velocidade}`,
    `^MD${modelo.escuro}`,
    `^PW${larguraDots}`,
    `^LL${alturaDots}`,
    "^LH0,0",
    ...modelo.elementos.map((el) => elementoParaZpl(el, dados, modelo.dpi, overrides?.[el.id])).filter((linha) => linha !== ""),
    `^PQ${quantidadeValida}`,
    "^XZ",
  ];
  return linhas.join("\n");
}

/** Monta o mapa de overrides (por id de elemento) a partir dos 4 campos editáveis da tela "Imprimir
 * etiqueta" (linha1/preco/linha3/codigo) — generaliza por `conteudo.campo` em vez de assumir um id
 * fixo por campo: achado real no code-review (2026-10-15) de que o modelo "Joia rabicho" tem DOIS
 * elementos ligados ao código (o texto "codigo" e o QR "qr") — editar o campo "código" na tela
 * precisa valer pros dois, senão o QR impresso diverge do texto/preview ao lado. Continua correto
 * pra um modelo futuro com mais de um elemento no mesmo campo, sem precisar listar ids na mão. */
export function construirOverridesPorCampo(
  elementos: ElementoEtiqueta[],
  valores: { linha1: string; preco: string; linha3: string; codigo: string },
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const el of elementos) {
    if (el.id === "linha1") {
      overrides[el.id] = valores.linha1;
      continue;
    }
    const campo = el.conteudo?.origem === "campo" ? el.conteudo.campo : undefined;
    if (campo === "preco_venda") overrides[el.id] = valores.preco;
    else if (campo === "codigo") overrides[el.id] = valores.codigo;
    else if (campo === "atributos" || campo === "categoria") overrides[el.id] = valores.linha3;
  }
  return overrides;
}
