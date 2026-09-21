import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

// Um client por request (Server Components/Actions/Route Handlers) — nunca
// reaproveitar entre requests, cada um tem seus próprios cookies de sessão.
export async function createClient() {
  const cookieStore = await cookies();
  // IP do usuário final, repassado ao banco para a trilha de auditoria (audit_log.ip_cliente). O primeiro
  // valor de x-forwarded-for é o que a plataforma (Vercel) registrou para a conexão do navegador.
  const ipCliente = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: ipCliente ? { headers: { "x-client-ip": ipCliente } } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // set() chamado a partir de um Server Component: ignorável
            // porque o middleware já cuida de renovar a sessão.
          }
        },
      },
    },
  );
}
