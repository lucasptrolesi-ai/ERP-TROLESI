import { mmParaDots, sanitizarCampoZpl } from "@/lib/etiquetas/zpl";
import { formatarMoeda } from "@/lib/formatar-moeda";
import type { ItemComCodigoAtacado } from "@/lib/relatorios-varejo";

// ZPL da notinha de dívida com o Atacado (2026-11-13) -- mesma impressora (Elgin L42 Pro Full) e
// mesmo dpi validado fisicamente pro Módulo Etiquetas (203.2, ver src/lib/etiquetas/zpl.ts), mas
// bobina CONTÍNUA (sem gap entre etiquetas, confirmado pelo usuário), não a bobina de etiqueta de
// joia com corte fixo -- por isso ^MNN (continuous) em vez do ^MNY (non-continuous/gap) que o motor
// de etiqueta usa, e altura calculada dinamicamente pelo número de itens em vez de um
// modelo.altura_mm fixo. `^PR`/`^MD` (velocidade/escuridão) aqui são um palpite razoável pra essa
// bobina nova, NÃO o valor validado fisicamente da etiqueta de joia (mídia diferente) -- é esperado
// precisar ajustar depois do primeiro teste real na impressora, mesma situação que a etiqueta de
// joia também teve (3 tentativas até calibrar, ver DECISIONS.md).
const DPI = 203.2;
const LARGURA_MM = 58;
const MARGEM_MM = 2;
const ALTURA_LINHA_MM = 3.4;
const ALTURA_FONTE_NORMAL = 20; // dots (~2.5mm) -- pequeno mas legível numa bobina de 58mm
const ALTURA_FONTE_TITULO = 28;
const VELOCIDADE_IPS = 4;
const ESCURIDAO = 15;
const MAX_CARACTERES_NOME = 18; // trunca pra não invadir o resto da linha (sem alinhamento em coluna, ver nota acima)

function truncar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}.` : texto;
}

function formatarCodigoZpl(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

type LinhaZpl = { texto: string; alturaFonte: number };

/** Gera o ZPL completo da notinha -- cabeçalho, uma linha por item (sem coluna alinhada: nome +
 * código + valor na mesma linha, texto corrido -- `^FB` com justificativa à direita exigiria
 * confiar numa largura de fonte proporcional sem poder testar fisicamente, risco maior que o ganho
 * visual), total, e a área "Pago em"/"Confirmação" pra anotar a quitação na via impressa. */
export function gerarZplNotinhaDivida(itens: ItemComCodigoAtacado[], total: number, emitidoEm: string): string {
  const linhas: LinhaZpl[] = [];
  linhas.push({ texto: "DIVIDA COM O ATACADO", alturaFonte: ALTURA_FONTE_TITULO });
  linhas.push({ texto: `Emitido em ${emitidoEm}`, alturaFonte: ALTURA_FONTE_NORMAL });
  linhas.push({ texto: "-".repeat(30), alturaFonte: ALTURA_FONTE_NORMAL });

  for (const item of itens) {
    const nome = truncar(item.produto_nome, MAX_CARACTERES_NOME);
    const texto = `${item.quantidade}x ${nome} cod.${formatarCodigoZpl(item.codigo_atacado)} ${formatarMoeda(item.custo_total)}`;
    linhas.push({ texto, alturaFonte: ALTURA_FONTE_NORMAL });
  }

  linhas.push({ texto: "-".repeat(30), alturaFonte: ALTURA_FONTE_NORMAL });
  linhas.push({ texto: `TOTAL EM ABERTO: ${formatarMoeda(total)}`, alturaFonte: ALTURA_FONTE_TITULO });
  linhas.push({ texto: "-".repeat(30), alturaFonte: ALTURA_FONTE_NORMAL });
  linhas.push({ texto: "Pago em: ___/___/______", alturaFonte: ALTURA_FONTE_NORMAL });
  linhas.push({ texto: "Confirmacao: ________________", alturaFonte: ALTURA_FONTE_NORMAL });

  const larguraDots = mmParaDots(LARGURA_MM, DPI);
  const margemDots = mmParaDots(MARGEM_MM, DPI);

  const corpo: string[] = [];
  let yMm = MARGEM_MM;
  for (const linha of linhas) {
    const yDots = mmParaDots(yMm, DPI);
    corpo.push(`^FO${margemDots},${yDots}^A0N,${linha.alturaFonte},${linha.alturaFonte}^FD${sanitizarCampoZpl(linha.texto)}^FS`);
    yMm += ALTURA_LINHA_MM * (linha.alturaFonte > ALTURA_FONTE_NORMAL ? 1.6 : 1);
  }
  const alturaDots = mmParaDots(yMm + MARGEM_MM, DPI);

  return [
    "^XA",
    "^CI28",
    "^MTD",
    "^MNN", // bobina contínua -- sem gap/marca pra sensorear, diferente da etiqueta de joia (^MNY)
    `^PR${VELOCIDADE_IPS},${VELOCIDADE_IPS}`,
    `^MD${ESCURIDAO}`,
    `^PW${larguraDots}`,
    `^LL${alturaDots}`,
    "^LH0,0",
    ...corpo,
    "^XZ",
  ].join("\n");
}
