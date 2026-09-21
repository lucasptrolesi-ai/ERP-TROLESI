import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROTAS_PUBLICAS, decidirAcesso, destinoInicial, encontrarRegra, type ContextoAcesso } from "@/lib/autorizacao/rotas";

const admin: ContextoAcesso = {
  papel: "admin",
  operacaoCodigo: "ATACADO",
  operacoes: [
    { codigo: "ATACADO", ativa: true },
    { codigo: "VAREJO", ativa: false },
  ],
};
const adminNoVarejo: ContextoAcesso = { ...admin, operacaoCodigo: "VAREJO" };
const vendedorAtacado: ContextoAcesso = { papel: "vendedor", operacaoCodigo: "ATACADO", operacoes: [{ codigo: "ATACADO", ativa: true }] };
const semOperacao: ContextoAcesso = { papel: "vendedor", operacaoCodigo: null, operacoes: [] };

describe("decidirAcesso — falha por padrão", () => {
  it("nega rota sem declaração", () => {
    expect(decidirAcesso("/rota-que-nao-existe", admin)).toEqual({ permitido: false, motivo: "sem_declaracao" });
    expect(decidirAcesso("/api/qualquer", admin)).toEqual({ permitido: false, motivo: "sem_declaracao" });
  });

  it("nega quando o contexto da sessão não pôde ser lido", () => {
    expect(decidirAcesso("/pedidos", null)).toEqual({ permitido: false, motivo: "sem_contexto" });
  });

  it("nega quando o usuário não tem perfil (papel nulo)", () => {
    expect(decidirAcesso("/conta", { papel: null, operacaoCodigo: null, operacoes: [] })).toEqual({ permitido: false, motivo: "papel" });
  });

  it("a raiz só casa exatamente; subcaminhos dela continuam sem declaração", () => {
    expect(decidirAcesso("/", vendedorAtacado).permitido).toBe(true);
    expect(encontrarRegra("/inventado")).toBeNull();
  });
});

describe("decidirAcesso — operação", () => {
  it("atacado acessa o módulo de atacado", () => {
    expect(decidirAcesso("/pedidos", vendedorAtacado).permitido).toBe(true);
    expect(decidirAcesso("/pedidos/123/cupom", vendedorAtacado).permitido).toBe(true);
    expect(decidirAcesso("/estoque/cadastro-ia", vendedorAtacado).permitido).toBe(true);
  });

  it("vendedor do atacado não acessa o PDV do varejo e não pode trocar", () => {
    expect(decidirAcesso("/pdv-eventos", vendedorAtacado)).toEqual({
      permitido: false,
      motivo: "operacao_errada",
      operacaoNecessaria: "VAREJO",
      podeTrocar: false,
    });
  });

  it("admin com as duas operações é orientado a trocar de operação", () => {
    expect(decidirAcesso("/pdv-eventos", admin)).toMatchObject({ permitido: false, motivo: "operacao_errada", podeTrocar: true });
    expect(decidirAcesso("/pdv-eventos", adminNoVarejo).permitido).toBe(true);
  });

  it("no varejo, as telas do atacado ficam negadas", () => {
    for (const rota of ["/pedidos", "/financeiro", "/estoque", "/cadastros", "/fiscal", "/crediario", "/transferencia"]) {
      expect(decidirAcesso(rota, adminNoVarejo)).toMatchObject({ permitido: false, motivo: "operacao_errada" });
    }
  });

  it("usuário sem operação só acessa o que independe dela", () => {
    expect(decidirAcesso("/pedidos", semOperacao)).toEqual({ permitido: false, motivo: "sem_operacao" });
    expect(decidirAcesso("/conta", semOperacao).permitido).toBe(true);
  });
});

describe("decidirAcesso — papel", () => {
  it("relatórios, GMax e permissões são só do admin", () => {
    for (const rota of ["/relatorios", "/gmax", "/permissoes"]) {
      expect(decidirAcesso(rota, vendedorAtacado)).toEqual({ permitido: false, motivo: "papel" });
      expect(decidirAcesso(rota, admin).permitido).toBe(true);
    }
  });
});

describe("destinoInicial", () => {
  it("cada operação abre na sua tela principal", () => {
    expect(destinoInicial("ATACADO")).toBe("/pedidos");
    expect(destinoInicial("VAREJO")).toBe("/varejo/pdv");
    expect(destinoInicial(null)).toBe("/pedidos");
  });
});

describe("cobertura das páginas", () => {
  function paginas(dir: string, acc: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) paginas(p, acc);
      else if (nome === "page.tsx") acc.push(p);
    }
    return acc;
  }

  it("toda página autenticada do app tem regra declarada (rota nova sem regra falha aqui)", () => {
    const raiz = path.resolve(process.cwd(), "src/app");
    const semRegra = paginas(raiz)
      .map((p) => {
        const partes = path
          .relative(raiz, path.dirname(p))
          .split(path.sep)
          .filter((s) => s && !/^\(.*\)$/.test(s))
          .map((s) => s.replace(/^\[.*\]$/, "x"));
        return "/" + partes.join("/");
      })
      .filter((caminho) => !ROTAS_PUBLICAS.some((r) => caminho.startsWith(r)))
      .filter((caminho) => encontrarRegra(caminho) === null);
    expect(semRegra).toEqual([]);
  });
});
