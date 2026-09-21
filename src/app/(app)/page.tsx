import { redirect } from "next/navigation";
import { destinoInicial } from "@/lib/autorizacao/rotas";
import { getContextoSessao } from "@/lib/supabase/contexto";

// Dashboard saiu do menu/rota principal (2026-07-20, fusão com o documento
// mestre do PDV) — o componente (dashboard-view.tsx) continua no
// repositório pra quando a Fase 5 (Relatórios) reconstruir isso de verdade.
// A raiz leva cada operação para a sua tela principal (PDV no atacado).
export default async function RaizRedirecionaParaTelaPrincipal() {
  const contexto = await getContextoSessao();
  redirect(destinoInicial(contexto?.operacao_codigo ?? null));
}
