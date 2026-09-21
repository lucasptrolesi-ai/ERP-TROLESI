"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getContextoSessao } from "@/lib/supabase/contexto";

/**
 * Troca a operação ativa do usuário (ex: admin indo do ATACADO para o VAREJO).
 *
 * A operação escolhida é gravada em app_metadata do usuário — campo que só o servidor altera,
 * o cliente não consegue forjar — e o token é renovado para carregá-la. Mesmo assim o banco
 * revalida a cada requisição (`operacao_atual()` confere `usuario_operacoes`), então um token
 * antigo ou adulterado cai na operação padrão em vez de abrir outra operação.
 */
export async function trocarOperacao(operacaoId: string): Promise<{ erro?: string }> {
  const contexto = await getContextoSessao();
  if (!contexto) return { erro: "Sessão inválida. Entre novamente." };

  const alvo = contexto.operacoes.find((o) => o.id === operacaoId);
  if (!alvo) return { erro: "Você não tem acesso a essa operação." };
  if (!alvo.ativa && contexto.papel !== "admin") return { erro: "Essa operação ainda não está ativa." };

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin.auth.admin.getUserById(contexto.usuario_id);
  if (erroLeitura || !atual.user) return { erro: "Não foi possível trocar de operação." };

  const { error } = await admin.auth.admin.updateUserById(contexto.usuario_id, {
    app_metadata: { ...atual.user.app_metadata, operacao_id: operacaoId },
  });
  if (error) return { erro: "Não foi possível trocar de operação." };

  const supabase = await createClient();
  const { error: erroRenovacao } = await supabase.auth.refreshSession();
  if (erroRenovacao) return { erro: "Operação trocada, mas a sessão não renovou. Saia e entre de novo." };

  revalidatePath("/", "layout");
  return {};
}
