import { describe, expect, it } from "vitest";
import { formatarMoeda } from "@/lib/formatar-moeda";
import {
  construirOverridesPorCampo,
  gerarBitmapQrGfa,
  mmParaDots,
  modeloParaZpl,
  resolverConteudo,
  sanitizarCampoZpl,
  type DadosPeca,
  type ElementoEtiqueta,
  type ModeloEtiqueta,
} from "@/lib/etiquetas/zpl";

// Modelo semente "Joia rabicho" (mesmos elementos gravados no banco pela migration 20261015000002) —
// seu ZPL tem que sair BYTE A BYTE idêntico ao template fixo aprovado e validado fisicamente antes
// deste motor genérico existir (ver DECISIONS.md). dpi: 203.2 (não 203) é proposital — ver mmParaDots.
const MODELO_JOIA_RABICHO: ModeloEtiqueta = {
  nome: "Joia rabicho",
  largura_mm: 95,
  altura_mm: 12,
  dpi: 203.2,
  velocidade: 2,
  escuro: 5,
  elementos: [
    {
      id: "linha1",
      nome: "Linha de cima",
      tipo: "texto",
      x_mm: 2,
      y_mm: 1.25,
      w_mm: 23,
      h_mm: 2.25,
      conteudo: { origem: "fixo", texto: "TROLESI" },
      fonte: { altura_mm: 2.25, largura_mm: 2.25, encolherSeNaoCouber: false },
      alinhamento: "centro",
    },
    {
      id: "preco",
      nome: "Preço",
      tipo: "texto",
      x_mm: 2,
      y_mm: 3.75,
      w_mm: 23,
      h_mm: 4.25,
      conteudo: { origem: "campo", campo: "preco_venda", formato: "moeda" },
      fonte: { altura_mm: 4.25, largura_mm: 3.25, encolherSeNaoCouber: false },
      alinhamento: "centro",
    },
    {
      id: "linha3",
      nome: "Linha de baixo",
      tipo: "texto",
      x_mm: 2,
      y_mm: 8.5,
      w_mm: 23,
      h_mm: 2.25,
      conteudo: { origem: "campo", campo: "atributos", campoSeVazio: "categoria" },
      fonte: { altura_mm: 2.25, largura_mm: 1.75, encolherSeNaoCouber: false },
      alinhamento: "centro",
      maxCaracteres: 20,
    },
    {
      id: "qr",
      nome: "QR code",
      tipo: "qr",
      x_mm: 27,
      y_mm: 2,
      w_mm: 7.875,
      h_mm: 7.875,
      conteudo: { origem: "campo", campo: "codigo" },
      maxCaracteres: 8,
      qr: { modulo_dots: 3, correcao: "M" },
    },
    {
      id: "sku_label",
      nome: 'Texto "SKU"',
      tipo: "texto",
      x_mm: 35.625,
      y_mm: 3.25,
      w_mm: 10,
      h_mm: 2.5,
      conteudo: { origem: "fixo", texto: "SKU" },
      fonte: { altura_mm: 2.5, largura_mm: 1.75, encolherSeNaoCouber: false },
      alinhamento: "esquerda",
    },
    {
      id: "codigo",
      nome: "Código",
      tipo: "texto",
      x_mm: 35.625,
      y_mm: 6.25,
      w_mm: 10,
      h_mm: 2.5,
      conteudo: { origem: "campo", campo: "codigo" },
      fonte: { altura_mm: 2.5, largura_mm: 1.5, encolherSeNaoCouber: false },
      alinhamento: "esquerda",
      maxCaracteres: 8,
    },
  ],
};

const DADOS_EXEMPLO: DadosPeca = {
  preco_venda: 189.9,
  nome: "Brinco argola média",
  codigo: "000423",
  atributos: "Folheado ouro 18k",
  categoria: "BRINCO",
  localizacao: "",
};

// formatarMoeda(189.9) -- não hard-codar o literal aqui: o Intl do Node insere um espaço NBSP
// (U+00A0) entre "R$" e o número, não um espaço comum, e já é o mesmo valor que a tela "Imprimir
// etiqueta" sempre usou (o ZPL fixo validado fisicamente passou por essa mesma função).
const ZPL_APROVADO_FIXO = (qrGfa: string) =>
  [
    "^XA",
    "^CI28",
    "^MTT",
    "^MNY",
    "^PR2,2",
    "^MD5",
    "^PW760",
    "^LL96",
    "^LH0,0",
    "^FO16,10^FB184,1,0,C^A0N,18,18^FDTROLESI^FS",
    `^FO16,30^FB184,1,0,C^A0N,34,26^FD${formatarMoeda(189.9)}^FS`,
    "^FO16,68^FB184,1,0,C^A0N,18,14^FDFolheado ouro 18k^FS",
    `^FO216,16^GFA,${qrGfa}^FS`,
    "^FO285,26^A0N,20,14^FDSKU^FS",
    "^FO285,50^A0N,20,12^FD000423^FS",
    "^PQ3",
    "^XZ",
  ].join("\n");

describe("modeloParaZpl — modelo semente 'Joia rabicho'", () => {
  it("gera ZPL byte a byte idêntico ao template fixo aprovado/validado fisicamente", () => {
    const zpl = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 3);
    const qrGfa = gerarBitmapQrGfa("000423");
    expect(zpl).toBe(ZPL_APROVADO_FIXO(qrGfa));
  });

  it("linha de baixo cai pra categoria quando a peça não tem atributos", () => {
    const zpl = modeloParaZpl(MODELO_JOIA_RABICHO, { ...DADOS_EXEMPLO, atributos: "" }, 1);
    expect(zpl).toContain("^FDBRINCO^FS");
    expect(zpl).not.toContain("Folheado");
  });

  it("quantidade nunca sai menor que 1", () => {
    const zpl = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 0);
    expect(zpl).toContain("^PQ1");
  });
});

describe("overrides (edição manual na tela, por id de elemento)", () => {
  it("override substitui o valor resolvido do campo, sem mudar o modelo", () => {
    const zpl = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 1, { linha3: "Editado na hora" });
    expect(zpl).toContain("^FDEditado na hora^FS");
    expect(zpl).not.toContain("Folheado");
  });

  it("override ainda respeita maxCaracteres do elemento", () => {
    const zpl = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 1, { codigo: "ABCDEFGHIJ" });
    expect(zpl).toContain("^FDABCDEFGH^FS");
    expect(zpl).not.toContain("ABCDEFGHIJ");
  });

  it("elemento sem override correspondente continua resolvendo normal", () => {
    const zpl = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 1, { linha3: "outra coisa" });
    expect(zpl).toContain("^FDTROLESI^FS");
  });
});

describe("construirOverridesPorCampo", () => {
  const valores = { linha1: "TROLESI", preco: "R$ 99,00", linha3: "Prata 925", codigo: "XYZ1" };

  it("o código editado vale pro texto 'codigo' E pro QR 'qr' (os dois têm conteudo.campo === 'codigo')", () => {
    const overrides = construirOverridesPorCampo(MODELO_JOIA_RABICHO.elementos, valores);
    expect(overrides.codigo).toBe("XYZ1");
    expect(overrides.qr).toBe("XYZ1");
  });

  it("linha1 (texto fixo) só aplica no elemento de id 'linha1'", () => {
    const overrides = construirOverridesPorCampo(MODELO_JOIA_RABICHO.elementos, valores);
    expect(overrides.linha1).toBe("TROLESI");
  });

  it("preco aplica no elemento ligado a preco_venda; linha3 no ligado a atributos/categoria", () => {
    const overrides = construirOverridesPorCampo(MODELO_JOIA_RABICHO.elementos, valores);
    expect(overrides.preco).toBe("R$ 99,00");
    expect(overrides.linha3).toBe("Prata 925");
  });

  it("o override de codigo de fato muda o que o QR codifica no ZPL final (não só o texto ao lado)", () => {
    const overrides = construirOverridesPorCampo(MODELO_JOIA_RABICHO.elementos, valores);
    const zplComOverride = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 1, overrides);
    const zplSemOverride = modeloParaZpl(MODELO_JOIA_RABICHO, DADOS_EXEMPLO, 1);
    const gfaComOverride = zplComOverride.match(/\^GFA,([^^]+)\^FS/)![1];
    const gfaSemOverride = zplSemOverride.match(/\^GFA,([^^]+)\^FS/)![1];
    expect(gfaComOverride).not.toBe(gfaSemOverride);
    expect(gfaComOverride).toBe(gerarBitmapQrGfa("XYZ1"));
  });
});

describe("mmParaDots", () => {
  it("95mm e 12mm a dpi=203.2 batem com o ^PW/^LL aprovados (760/96) — não com dpi=203 (759/96, 1 dot a menos de largura)", () => {
    expect(mmParaDots(95, 203.2)).toBe(760);
    expect(mmParaDots(12, 203.2)).toBe(96);
    expect(mmParaDots(95, 203)).toBe(759);
  });
});

describe("sanitizarCampoZpl", () => {
  it("remove ^, ~ e \\ (quebrariam o campo ^FD...^FS do ZPL)", () => {
    expect(sanitizarCampoZpl("A^B~C\\D")).toBe("ABCD");
  });
});

describe("resolverConteudo", () => {
  const dados: DadosPeca = { preco_venda: 50, nome: "Peça", codigo: "A1B2C3D4E5", atributos: "", categoria: "ANEL", localizacao: "" };

  it("origem fixo usa o texto literal, ignora campo", () => {
    expect(resolverConteudo({ origem: "fixo", texto: "TROLESI" }, dados)).toBe("TROLESI");
  });

  it("campo vazio cai pro campoSeVazio", () => {
    expect(resolverConteudo({ origem: "campo", campo: "atributos", campoSeVazio: "categoria" }, dados)).toBe("ANEL");
  });

  it("maxCaracteres trunca o dado ANTES do prefixo entrar", () => {
    expect(resolverConteudo({ origem: "campo", campo: "codigo", prefixo: "SKU " }, dados, 4)).toBe("SKU A1B2");
  });

  it("formato moeda converte número pra R$", () => {
    expect(resolverConteudo({ origem: "campo", campo: "preco_venda", formato: "moeda" }, dados)).toBe(formatarMoeda(50));
  });

  it("formato maiusculas converte o texto", () => {
    expect(resolverConteudo({ origem: "fixo", texto: "folheado", formato: "maiusculas" }, dados)).toBe("FOLHEADO");
  });
});

describe("elementos de código de barras", () => {
  const dados: DadosPeca = { preco_venda: 10, nome: "Peça", codigo: "123", atributos: "", categoria: "", localizacao: "" };

  function elementoBarcode(simbologia: "code128" | "itf", codigo: string): ElementoEtiqueta {
    return {
      id: "b",
      nome: "Barras",
      tipo: "barcode",
      x_mm: 2,
      y_mm: 2,
      w_mm: 30,
      h_mm: 8,
      conteudo: { origem: "fixo", texto: codigo },
      barcode: { simbologia, modulo_dots: 2, altura_mm: 8 },
    };
  }

  const modeloBase: Omit<ModeloEtiqueta, "elementos"> = { nome: "Teste", largura_mm: 40, altura_mm: 15, dpi: 203.2, velocidade: 2, escuro: 5 };

  it("code128 aceita alfanumérico", () => {
    const zpl = modeloParaZpl({ ...modeloBase, elementos: [elementoBarcode("code128", "ABC123")] }, dados, 1);
    expect(zpl).toContain("^BCN");
    expect(zpl).toContain("^FDABC123^FS");
  });

  it("itf aceita quantidade par de dígitos", () => {
    const zpl = modeloParaZpl({ ...modeloBase, elementos: [elementoBarcode("itf", "1234")] }, dados, 1);
    expect(zpl).toContain("^B2N");
  });

  it("itf rejeita quantidade ímpar de dígitos", () => {
    expect(() => modeloParaZpl({ ...modeloBase, elementos: [elementoBarcode("itf", "123")] }, dados, 1)).toThrow(/par/);
  });

  it("itf rejeita caractere não numérico", () => {
    expect(() => modeloParaZpl({ ...modeloBase, elementos: [elementoBarcode("itf", "12A4")] }, dados, 1)).toThrow(/dígitos/);
  });
});

describe("encolherSeNaoCouber", () => {
  const dados: DadosPeca = { preco_venda: 10, nome: "Peça", codigo: "A1", atributos: "", categoria: "", localizacao: "" };
  const modeloBase: Omit<ModeloEtiqueta, "elementos"> = { nome: "Teste", largura_mm: 40, altura_mm: 15, dpi: 203.2, velocidade: 2, escuro: 5 };

  function elementoTexto(texto: string, encolher: boolean): ElementoEtiqueta {
    return {
      id: "t",
      nome: "Texto",
      tipo: "texto",
      x_mm: 2,
      y_mm: 2,
      w_mm: 10, // 80 dots
      h_mm: 4,
      conteudo: { origem: "fixo", texto },
      fonte: { altura_mm: 4, largura_mm: 4, encolherSeNaoCouber: encolher }, // 32 dots de largura de fonte
      alinhamento: "esquerda",
    };
  }

  it("não encolhe quando o texto já cabe", () => {
    const zpl = modeloParaZpl({ ...modeloBase, elementos: [elementoTexto("AB", true)] }, dados, 1);
    expect(zpl).toContain("^A0N,32,32^FDAB^FS");
  });

  it("encolhe a fonte até o texto caber na largura do elemento", () => {
    const zpl = modeloParaZpl({ ...modeloBase, elementos: [elementoTexto("TEXTOBEMLONGOAQUI", true)] }, dados, 1);
    const linha = zpl.split("\n").find((l) => l.includes("TEXTOBEMLONGOAQUI"))!;
    const largura = Number(linha.match(/\^A0N,\d+,(\d+)\^FD/)![1]);
    expect(largura * "TEXTOBEMLONGOAQUI".length).toBeLessThanOrEqual(80);
    expect(largura).toBeLessThan(32);
  });

  it("sem encolherSeNaoCouber, mantém a fonte mesmo se não couber", () => {
    const zpl = modeloParaZpl({ ...modeloBase, elementos: [elementoTexto("TEXTOBEMLONGOAQUI", false)] }, dados, 1);
    expect(zpl).toContain("^A0N,32,32^FDTEXTOBEMLONGOAQUI^FS");
  });
});
