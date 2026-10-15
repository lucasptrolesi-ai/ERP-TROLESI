import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { gerarZpl, type DadosEtiqueta } from "@/lib/etiquetas/zpl";

// print-agent/etiqueta-zpl.js é uma cópia em JS puro (sem build, sem TypeScript) do mesmo gerador —
// existe duplicada porque o print-agent roda isolado numa Mac da loja, instalado como pasta copiada
// (não faz parte do bundle do Next.js). Este teste é a rede de segurança contra as duas cópias
// divergirem: se alguém mudar um lado e esquecer o outro, falha aqui, não só na impressora física.
const requireNode = createRequire(import.meta.url);
const agente = requireNode("../../../print-agent/etiqueta-zpl.js") as { gerarZpl: (dados: DadosEtiqueta) => string };

const CASOS: DadosEtiqueta[] = [
  { linha1: "TROLESI", preco: "R$ 189,90", linha3: "Folheado ouro 18k", codigo: "000423", quantidade: 3 },
  { linha1: "", preco: "R$ 0,00", linha3: "", codigo: "A", quantidade: 1 },
  { linha1: "TROLESI JOIAS", preco: "R$ 1.234,56", linha3: "Prata 925 com pedra", codigo: "ZZ000999", quantidade: 12 },
  { linha1: "A^B~C\\D", preco: "R$ 10,00", linha3: "x~y^z\\w", codigo: "C^O~D\\E", quantidade: 1 },
];

describe("consistência TS (src/lib/etiquetas/zpl.ts) × JS (print-agent/etiqueta-zpl.js)", () => {
  it.each(CASOS)("gera o mesmo ZPL nas duas cópias para %j", (dados) => {
    expect(agente.gerarZpl(dados)).toBe(gerarZpl(dados));
  });
});
