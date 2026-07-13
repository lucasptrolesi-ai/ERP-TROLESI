import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROTAS_PUBLICAS = ["/login"];

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

  const rotaPublica = ROTAS_PUBLICAS.some((rota) => request.nextUrl.pathname.startsWith(rota));

  const semRedirecionamento = (user && !rotaPublica) || (!user && rotaPublica);
  if (semRedirecionamento) {
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
