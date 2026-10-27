import { NextResponse } from "next/server";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { trocarOperacao } from "@/lib/actions/operacao";

export const runtime = "nodejs";

/**
 * Autocorrige a operação ativa da sessão quando o token guardado no navegador fica desatualizado
 * (ex: app fechado e reaberto com um token que ainda carrega a operação anterior) mas o usuário
 * já tem acesso legítimo à operação que a rota pedia — `middleware.ts` chama isso só nesse caso
 * específico (achado 2026-10-27: "toda vez que fecho e abro o app aparece Acesso negado").
 *
 * Revalida tudo de novo aqui, server-side, a partir da sessão autenticada -- nunca confia no
 * `operacaoCodigo` do corpo da requisição por si só; ele só serve pra escolher QUAL das operações
 * que o próprio usuário já tem (`contexto_sessao().operacoes`) deve virar a ativa. Mesma garantia
 * de sempre: o banco (`operacao_atual()`/RLS) é quem decide de verdade, isto é só housekeeping de
 * token.
 */
export async function POST(request: Request) {
  const corpo = await request.json().catch(() => null);
  const operacaoCodigo = corpo && typeof corpo.operacaoCodigo === "string" ? corpo.operacaoCodigo : null;
  if (!operacaoCodigo) {
    return NextResponse.json({ erro: "Código de operação inválido." }, { status: 400 });
  }

  const contexto = await getContextoSessao();
  if (!contexto) {
    return NextResponse.json({ erro: "Sessão inválida." }, { status: 401 });
  }

  const alvo = contexto.operacoes.find((o) => o.codigo === operacaoCodigo);
  if (!alvo) {
    return NextResponse.json({ erro: "Você não tem acesso a essa operação." }, { status: 403 });
  }

  const resultado = await trocarOperacao(alvo.id);
  if (resultado.erro) {
    return NextResponse.json({ erro: resultado.erro }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
