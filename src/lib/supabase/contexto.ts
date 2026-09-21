import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ContextoSessao } from "@/lib/autorizacao/tipos";

/**
 * Contexto da sessão (papel, operação atual, operações do usuário, permissões) numa única
 * chamada ao banco, uma vez por request. A operação é resolvida e validada pelo próprio banco
 * (`contexto_sessao()` → `operacao_atual()`); o cliente nunca a informa.
 *
 * Devolve null se a chamada falhar — quem usa deve tratar como acesso negado (falha fechada).
 */
export const getContextoSessao = cache(async (): Promise<ContextoSessao | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contexto_sessao");
  if (error || !data) {
    console.error("contexto_sessao falhou:", error?.message ?? "sem dados");
    return null;
  }
  return data as ContextoSessao;
});
