import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Um client por request (Server Components/Actions/Route Handlers) — nunca
// reaproveitar entre requests, cada um tem seus próprios cookies de sessão.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
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
