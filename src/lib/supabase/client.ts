import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Uma instância só por aba (não uma nova a cada chamada): evita abrir vários
// sockets Realtime concorrentes do mesmo navegador (ex: o RealtimeRefresh do
// AppShell + qualquer outro canal, como o pareamento da câmera do celular) —
// visto na prática causando CHANNEL_ERROR num dos canais quando havia mais
// de uma conexão Realtime disputando ao mesmo tempo (2026-09-01).
let instancia: SupabaseClient | undefined;

export function createClient() {
  instancia ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return instancia;
}
