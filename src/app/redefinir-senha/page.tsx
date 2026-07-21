"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandBadge } from "@/components/brand-badge";
import { FormField } from "@/components/form-field";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  // O link do e-mail de recuperação estabelece a sessão via token no hash
  // da URL (#access_token=...) — só o SDK client-side consegue ler isso,
  // por isso essa checagem só é possível aqui, não num server component.
  const [sessaoValida, setSessaoValida] = useState<boolean | null>(null);
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, session) => {
      if (evento === "PASSWORD_RECOVERY" || session) setSessaoValida(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessaoValida(true);
    });
    const semSessao = setTimeout(() => setSessaoValida((atual) => atual ?? false), 3000);
    return () => {
      subscription.unsubscribe();
      clearTimeout(semSessao);
    };
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) {
      setErro("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmarSenha) {
      setErro("As senhas não coincidem.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      setErro("Não foi possível salvar a nova senha. Tente pedir um novo link de recuperação.");
      return;
    }
    setSucesso(true);
    setTimeout(() => router.push("/"), 1500);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-lg">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <BrandBadge variant="gold" size="lg">
            T
          </BrandBadge>
          <h1 className="font-display text-2xl font-semibold text-ink">Nova senha</h1>
        </div>

        {sessaoValida === null && <p className="text-center text-sm text-text-soft">Verificando link…</p>}

        {sessaoValida === false && (
          <p className="rounded-lg bg-crit-bg px-3 py-3 text-center text-sm font-medium text-crit">
            Link inválido ou expirado. Peça um novo em &quot;Esqueci minha senha&quot; na tela de login.
          </p>
        )}

        {sessaoValida && sucesso && (
          <p className="rounded-lg bg-ok-bg px-3 py-3 text-center text-sm font-medium text-ok">
            Senha atualizada! Entrando…
          </p>
        )}

        {sessaoValida && !sucesso && (
          <form onSubmit={salvar} className="flex flex-col gap-4">
            <FormField
              label="Nova senha"
              name="senha"
              type="password"
              required
              autoComplete="new-password"
              onChange={(e) => setSenha(e.target.value)}
            />
            <FormField
              label="Confirmar nova senha"
              name="confirmar_senha"
              type="password"
              required
              autoComplete="new-password"
              onChange={(e) => setConfirmarSenha(e.target.value)}
            />

            {erro && (
              <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={salvando}
              className="mt-2 rounded-full bg-gradient-to-br from-rose to-rose-deep py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
            >
              {salvando ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
