import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente com a service_role key — bypassa RLS e tem acesso a `auth.admin.*`
 * (ex: criar usuário). NUNCA importar isso num client component nem expor
 * a chave com prefixo NEXT_PUBLIC_. Só para uso dentro de server actions que
 * já verificaram explicitamente que quem chamou é admin (RLS não protege
 * nada aqui, a checagem tem que ser manual antes de usar este cliente).
 */
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
