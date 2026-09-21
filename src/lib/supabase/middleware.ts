import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ROTAS_PUBLICAS, decidirAcesso, type DecisaoAcesso, type MotivoNegacao } from "@/lib/autorizacao/rotas";
import type { ContextoSessao } from "@/lib/autorizacao/tipos";

const MENSAGENS: Record<MotivoNegacao, string> = {
  sem_declaracao: "Esta página não está liberada.",
  sem_contexto: "Não foi possível validar o seu acesso agora. Tente novamente em instantes.",
  sem_operacao: "Seu usuário não está vinculado a nenhuma operação. Peça a um administrador.",
  papel: "Seu perfil não tem acesso a esta página.",
  operacao_errada: "Esta página é de outra operação.",
};

// Autorização por rota, falha por padrão (regra 2): a rota precisa estar declarada em
// src/lib/autorizacao/rotas.ts e o contexto vem do banco (`contexto_sessao`). Se o banco não
// responder, nega — nunca libera por falta de informação.
async function decidirAcessoDaSessao(supabase: SupabaseClient, caminho: string): Promise<DecisaoAcesso> {
  const { data, error } = await supabase.rpc("contexto_sessao");
  if (error || !data) {
    console.error("proxy: contexto_sessao falhou:", error?.message ?? "sem dados");
    return decidirAcesso(caminho, null);
  }
  const contexto = data as ContextoSessao;
  return decidirAcesso(caminho, {
    papel: contexto.papel,
    operacaoCodigo: contexto.operacao_codigo,
    operacoes: contexto.operacoes,
  });
}

function respostaNegada(decisao: Extract<DecisaoAcesso, { permitido: false }>, comCookies: NextResponse): NextResponse {
  const dica =
    decisao.motivo === "operacao_errada" && decisao.podeTrocar
      ? `<p>Troque de operação no menu superior para abrir esta página.</p>`
      : "";
  const html =
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Acesso negado</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
    `<h1>Acesso negado</h1><p>${MENSAGENS[decisao.motivo]}</p>${dica}<p><a href="/">Voltar ao início</a></p></body></html>`;
  const resposta = new NextResponse(html, {
    status: decisao.motivo === "sem_contexto" ? 503 : 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  // getUser() pode ter renovado o token — preserva os cookies na resposta negada também.
  comCookies.cookies.getAll().forEach((cookie) => resposta.cookies.set(cookie));
  return resposta;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() (não getSession()) — valida o token com o servidor Supabase a
  // cada request, não confia só no cookie local.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const caminho = request.nextUrl.pathname;
  const rotaPublica = ROTAS_PUBLICAS.some((rota) => caminho.startsWith(rota));

  if (user && !rotaPublica) {
    const decisao = await decidirAcessoDaSessao(supabase, caminho);
    return decisao.permitido ? response : respostaNegada(decisao, response);
  }

  if (!user && rotaPublica) {
    return response;
  }

  const url = request.nextUrl.clone();
  url.pathname = user ? "/" : "/login";
  const redirect = NextResponse.redirect(url);
  // getUser() pode ter renovado o token (setAll acima) — sem copiar esses
  // cookies para a resposta de redirect, o navegador guarda uma sessão já
  // invalidada no servidor e cai num loop de logout forçado.
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
