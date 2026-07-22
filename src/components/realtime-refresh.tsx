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
    const canal = supabase.channel("erp-trolesi-mudancas");

    function agendarRefresh() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => router.refresh(), 400);
    }

    for (const tabela of TABELAS_TEMPO_REAL) {
      canal.on("postgres_changes", { event: "*", schema: "public", table: tabela }, agendarRefresh);
    }
    canal.subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(canal);
    };
  }, [router]);

  return null;
}
