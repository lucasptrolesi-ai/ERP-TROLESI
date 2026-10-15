import { describe, expect, it } from "vitest";
import {
  ETIQUETA_CODIGO_MAX,
  ETIQUETA_LINHA3_MAX,
  gerarBitmapQrGfa,
  gerarZpl,
  preencherEtiquetaAPartirDaPeca,
  sanitizarCampoZpl,
} from "@/lib/etiquetas/zpl";

// Caso de exemplo do plano aprovado (etiqueta 95×12mm, Elgin L42 Pro Full) — snapshot: o ZPL inteiro
// é longo/binário (hex do QR), comparar campo a campo seria tão frágil quanto o snapshot; o que
// importa é que ele não mude sem intenção (qualquer mudança real no template precisa reimprimir e
// remedir na impressora física antes de atualizar o snapshot).
describe("gerarZpl", () => {
  it("gera o ZPL esperado pro exemplo do plano (código 000423, 3 etiquetas)", () => {
    const zpl = gerarZpl({ linha1: "TROLESI", preco: "R$ 189,90", linha3: "Folheado ouro 18k", codigo: "000423", quantidade: 3 });
    expect(zpl).toMatchSnapshot();
  });

  it("quantidade nunca sai menor que 1, mesmo pedindo 0 ou negativo", () => {
    const zpl = gerarZpl({ linha1: "TROLESI", preco: "R$ 1,00", linha3: "", codigo: "A1", quantidade: 0 });
    expect(zpl).toContain("^PQ1");
  });
});

describe("sanitizarCampoZpl", () => {
  it("remove ^, ~ e \\ (quebrariam o campo ^FD...^FS do ZPL)", () => {
    expect(sanitizarCampoZpl("A^B~C\\D")).toBe("ABCD");
  });

  it("texto sem nenhum desses caracteres não muda", () => {
    expect(sanitizarCampoZpl("Folheado ouro 18k")).toBe("Folheado ouro 18k");
  });
});

describe("gerarBitmapQrGfa", () => {
  it("código curto (até 8 caracteres) fica na versão 1 do QR: 63×63 dots, 504 bytes", () => {
    const gfa = gerarBitmapQrGfa("000423");
    const [totalBytesTexto, totalBytesTexto2, bytesPorLinhaTexto, hex] = gfa.split(",");
    expect(Number(totalBytesTexto)).toBe(504);
    expect(Number(totalBytesTexto2)).toBe(504);
    expect(Number(bytesPorLinhaTexto)).toBe(8);
    expect(hex).toHaveLength(504 * 2);
  });

  it("escala vertical: cada linha de módulo vira 3 linhas idênticas no bitmap", () => {
    const gfa = gerarBitmapQrGfa("000423");
    const [, , bytesPorLinhaTexto, hex] = gfa.split(",");
    const bytesPorLinha = Number(bytesPorLinhaTexto);
    const bytes = hex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16));
    const linha0 = bytes.slice(0, bytesPorLinha);
    const linha1 = bytes.slice(bytesPorLinha, bytesPorLinha * 2);
    const linha2 = bytes.slice(bytesPorLinha * 2, bytesPorLinha * 3);
    expect(linha1).toEqual(linha0);
    expect(linha2).toEqual(linha0);
  });

  it("canto superior esquerdo é preto (bit 1) — sempre faz parte do finder pattern do QR", () => {
    const gfa = gerarBitmapQrGfa("000423");
    const [, , , hex] = gfa.split(",");
    const primeiroByte = Number.parseInt(hex.slice(0, 2), 16);
    expect(primeiroByte & 0b1000_0000).not.toBe(0);
  });
});

describe("preencherEtiquetaAPartirDaPeca", () => {
  it("peça sem atributos usa a categoria como linha de baixo", () => {
    const dados = preencherEtiquetaAPartirDaPeca({
      precoVenda: 50,
      precoFormatado: "R$ 50,00",
      atributos: {},
      categoria: "ANEL",
      sku: "A1",
      quantidadeEstoque: null,
    });
    expect(dados.linha3).toBe("ANEL");
  });

  it("peça com atributos usa os atributos, não a categoria", () => {
    const dados = preencherEtiquetaAPartirDaPeca({
      precoVenda: 50,
      precoFormatado: "R$ 50,00",
      atributos: { variacao: "Folheado ouro 18k" },
      categoria: "ANEL",
      sku: "A1",
    });
    expect(dados.linha3).toBe("Folheado ouro 18k");
  });

  it("trunca a linha de baixo em 20 caracteres", () => {
    const dados = preencherEtiquetaAPartirDaPeca({
      precoVenda: 50,
      precoFormatado: "R$ 50,00",
      atributos: { variacao: "Um texto de atributo bem mais longo que vinte caracteres" },
      categoria: null,
      sku: "A1",
    });
    expect(dados.linha3).toHaveLength(ETIQUETA_LINHA3_MAX);
  });

  it("trunca o código em 8 caracteres", () => {
    const dados = preencherEtiquetaAPartirDaPeca({
      precoVenda: 50,
      precoFormatado: "R$ 50,00",
      atributos: null,
      categoria: null,
      sku: "CODIGOMUITOLONGO123",
    });
    expect(dados.codigo).toHaveLength(ETIQUETA_CODIGO_MAX);
  });

  it("quantidade padrão é 1 quando não entrou nada no estoque ainda", () => {
    const dados = preencherEtiquetaAPartirDaPeca({ precoVenda: 50, precoFormatado: "R$ 50,00", atributos: null, categoria: null, sku: "A1" });
    expect(dados.quantidade).toBe(1);
  });

  it("quantidade vem da quantidade que entrou no estoque (cadastro 'Veio do Atacado?'), quando houver", () => {
    const dados = preencherEtiquetaAPartirDaPeca({
      precoVenda: 50,
      precoFormatado: "R$ 50,00",
      atributos: null,
      categoria: null,
      sku: "A1",
      quantidadeEstoque: 5,
    });
    expect(dados.quantidade).toBe(5);
  });
});
