import { redirect } from "next/navigation";

// Dashboard saiu do menu/rota principal (2026-07-20, fusão com o documento
// mestre do PDV) — o componente (dashboard-view.tsx) continua no
// repositório pra quando a Fase 5 (Relatórios) reconstruir isso de verdade.
// PDV (tela de Pedidos) é a tela principal agora.
export default function RaizRedirecionaParaPdv() {
  redirect("/pedidos");
}
