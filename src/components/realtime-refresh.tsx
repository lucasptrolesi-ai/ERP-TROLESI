"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABELAS_TEMPO_REAL = ["produtos", "pedidos", "pedido_itens", "contas_receber", "contas_pagar"] as const;

/** Mantém a tela atual (e o sininho de vencimentos no layout raiz)
 * refletindo o que outro terminal acabou de gravar, sem precisar de F5 — a
 * loja fecha venda em vários aparelhos ao mesmo tempo. Debounced porque uma
 * única ação (ex: criar_pedido) grava várias linhas em sequência (pedido +
 * itens + parcelas); um router.refresh() por gravação basta, não um por
 * linha. Montado uma vez no AppShell (sempre presente enquanto logado), não
 * em cada página — router.refresh() já re-busca o layout e a página atual. */
export function RealtimeRefresh() {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    function agendarRefresh() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => router.refresh(), 400);
    }

    // Achado numa varredura de erros (2026-10-23): esse canal ficava em loop de reconexão
    // (401) pra sempre, em toda aba aberta, desde o início do projeto. A suspeita mais provável
    // é uma corrida: o useEffect assinava o canal antes da sessão de auth terminar de carregar
    // dos cookies, e o Realtime usa o token de sessão (não só a apikey) pra autorizar o canal --
    // sem sessão resolvida ainda, cai num fallback que o servidor rejeita, e o estado de erro
    // não se autocorrige nas tentativas seguintes. Esperar getSession() resolver antes de criar
    // o canal garante que o token já está disponível na primeira tentativa.
    supabase.auth.getSession().then(() => {
      if (cancelado) return;
      canal = supabase.channel("erp-trolesi-mudancas");
      for (const tabela of TABELAS_TEMPO_REAL) {
        canal.on("postgres_changes", { event: "*", schema: "public", table: tabela }, agendarRefresh);
      }
      canal.subscribe();
    });

    return () => {
      cancelado = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (canal) supabase.removeChannel(canal);
    };
  }, [router]);

  return null;
}
