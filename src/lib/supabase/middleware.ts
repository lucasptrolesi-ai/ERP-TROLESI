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

/** Marcador na própria URL pra nunca tentar autocorrigir duas vezes o mesmo carregamento — sem
 * isso, se a correção não resolver de verdade, o reload cairia num loop infinito. */
const MARCADOR_AUTOCORRECAO = "_opfix";

function respostaNegada(
  decisao: Extract<DecisaoAcesso, { permitido: false }>,
  comCookies: NextResponse,
  urlOriginal: URL,
): NextResponse {
  // Achado 2026-10-27 ("toda vez que fecho e abro o app aparece Acesso negado"): o token guardado
  // no navegador às vezes reabre com a operação desatualizada (ex: a padrão do usuário) mesmo com
  // `app_metadata` já certo no banco. Nesses casos o usuário TEM acesso legítimo à operação que a
  // rota pede (podeTrocar=true) — em vez de travar numa tela morta, a própria página tenta se
  // autocorrigir uma vez (POST em /api/corrigir-operacao, que revalida tudo server-side) e recarrega
  // sozinha. Só tenta uma vez por carregamento (marcador na URL) pra nunca entrar em loop.
  const jaTentouAutocorrigir = urlOriginal.searchParams.has(MARCADOR_AUTOCORRECAO);
  const podeAutocorrigir = decisao.motivo === "operacao_errada" && decisao.podeTrocar && !jaTentouAutocorrigir;

  const dica =
    decisao.motivo === "operacao_errada" && decisao.podeTrocar
      ? `<p>Troque de operação no menu superior para abrir esta página.</p>`
      : "";

  const scriptAutocorrecao = podeAutocorrigir
    ? `<p id="ajustando">Ajustando sua sessão…</p>
       <script>
         fetch("/api/corrigir-operacao", {
           method: "POST",
           headers: { "content-type": "application/json" },
           body: JSON.stringify({ operacaoCodigo: ${JSON.stringify(decisao.operacaoNecessaria ?? "")} }),
         })
           .then(function (r) { return r.ok; })
           .catch(function () { return false; })
           .then(function (ok) {
             var destino = new URL(location.href);
             destino.searchParams.set(${JSON.stringify(MARCADOR_AUTOCORRECAO)}, "1");
             if (ok) { location.replace(destino.pathname + destino.search); }
             else { document.getElementById("ajustando").hidden = true; document.getElementById("erro-final").hidden = false; }
           });
       </script>`
    : "";

  const html =
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Acesso negado</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
    `<h1>Acesso negado</h1>` +
    `<div id="erro-final"${podeAutocorrigir ? " hidden" : ""}><p>${MENSAGENS[decisao.motivo]}</p>${dica}<p><a href="/">Voltar ao início</a></p></div>` +
    `${scriptAutocorrecao}` +
    `</body></html>`;
  const resposta = new NextResponse(html, {
    status: decisao.motivo === "sem_contexto" ? 503 : 403,
    // `no-store` aqui não é só higiene de cache -- é o que tira esta resposta do bfcache do Safari
    // (achado 2026-10-27: o app fixado no Dock reabria mostrando a MESMA tela negada congelada,
    // sem bater no servidor de novo, mesmo depois do fix de autocorreção já estar no ar -- sem
    // `no-store`, o navegador pode restaurar essa página do zero a partir do snapshot da aba
    // fechada, nunca rodando o script de autocorreção de novo).
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, must-revalidate" },
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
    return decisao.permitido ? response : respostaNegada(decisao, response, request.nextUrl);
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
