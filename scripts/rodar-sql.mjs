// Roda um arquivo .sql direto no Postgres, sem passar pelo Editor do Supabase -- criado em
// 2026-10-24 porque o Editor do Dashboard tem um "detector de CREATE TABLE" (pra lembrar de
// habilitar RLS em tabela nova) que confunde variáveis internas de function (declare v_x uuid;
// ... select ... into v_x ...) com tabela nova, e cola `ALTER TABLE v_x ENABLE ROW LEVEL SECURITY`
// no meio do corpo da function -- quebra o parsing de qualquer migration com function grande o
// suficiente. Indo direto pro Postgres (via node-postgres), esse pré-processamento do Dashboard
// nunca entra em cena.
//
// Uso:
//   DATABASE_URL="postgresql://..." node scripts/rodar-sql.mjs supabase/migrations/ARQUIVO.sql
//
// A connection string (Session Pooler, porta 5432) está em:
//   Supabase Dashboard -> Project Settings -> Database -> Connection string -> Session pooler
//
// Mostra toda mensagem RAISE NOTICE/EXCEPTION do Postgres -- inclusive o "ENSAIO OK: ..." (que é
// o sinal de SUCESSO esperado quando roda em modo ensaio, não um erro de verdade).

import { readFileSync } from "node:fs";
import { Client } from "pg";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("Uso: DATABASE_URL=... node scripts/rodar-sql.mjs caminho/do/arquivo.sql");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Faltou a variável DATABASE_URL (a connection string do Supabase).");
  process.exit(1);
}

const sql = readFileSync(arquivo, "utf8");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

client.on("notice", (msg) => {
  console.log(`\n[NOTICE] ${msg.message}`);
});

try {
  await client.connect();
  console.log(`Conectado. Rodando ${arquivo}...\n`);
  await client.query(sql);
  console.log("\nConcluído sem erro (nenhuma exceção levantada).");
} catch (erro) {
  console.log(`\n[RESULTADO] ${erro.message}`);
  if (/^ENSAIO OK/.test(erro.message)) {
    console.log("\n^ Isso é o sinal de SUCESSO esperado do modo ensaio -- não é um erro de verdade.");
  }
} finally {
  await client.end();
}
