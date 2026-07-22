import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // print-agent/ é um serviço Node standalone à parte (CommonJS puro, sem
    // build step, roda direto com `node agent.js` no PC da loja) — não faz
    // parte do app Next.js/TypeScript, não segue as mesmas regras de lint.
    "print-agent/**",
  ]),
]);

export default eslintConfig;
