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
    {
      // O servidor de Realtime deste projeto rejeita a apikey nova (sb_publishable_...) no
      // handshake do WebSocket com 401 -- achado numa varredura de erros (2026-10-23): o
      // RealtimeRefresh (AppShell) reconectava sem parar, pra sempre, em toda aba aberta, sem
      // nunca autenticar. REST/Auth continuam na chave nova (funcionam normalmente); só o
      // apikey passado especificamente pro Realtime precisa ser a anon key antiga (JWT, ainda
      // ativa no projeto) até a Supabase atualizar o servidor de Realtime pra aceitar a nova.
      realtime: { params: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LEGACY! } },
    },
  );
  return instancia;
}
