"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BrandBadge } from "@/components/brand-badge";
import { FormField } from "@/components/form-field";

export default function EsqueciSenhaPage() {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(formData: FormData) {
    const emailDigitado = String(formData.get("email") ?? "").trim();
    if (!emailDigitado) {
      setErro("Informe o e-mail da sua conta.");
      return;
    }
    setErro(null);
    setEnviando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(emailDigitado, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setEnviando(false);
    // Sempre mostra a mesma mensagem de sucesso, exista ou não o e-mail —
    // não revela pra quem tenta se um endereço tem conta ou não.
    if (error) console.error("Falha ao solicitar recuperação de senha:", error.code ?? error.name, error.message);
    setEnviado(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-lg">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <BrandBadge variant="gold" size="lg">
            T
          </BrandBadge>
          <h1 className="font-display text-2xl font-semibold text-ink">Recuperar senha</h1>
          <p className="text-sm text-text-soft">Informe o e-mail da sua conta na equipe</p>
        </div>

        {enviado ? (
          <div className="flex flex-col gap-4 text-center">
            <p className="rounded-lg bg-ok-bg px-3 py-3 text-sm font-medium text-ok">
              Se esse e-mail tiver uma conta, enviamos um link pra redefinir a senha. Confira sua caixa de entrada
              (e o spam).
            </p>
            <Link href="/login" className="text-sm font-semibold text-rose-deep hover:underline">
              Voltar pro login
            </Link>
          </div>
        ) : (
          <form action={enviar} className="flex flex-col gap-4">
            <FormField label="E-mail" name="email" type="email" required autoComplete="email" />

            {erro && (
              <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="mt-2 rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
            >
              {enviando ? "Enviando…" : "Enviar link de recuperação"}
            </button>
            <Link href="/login" className="text-center text-sm font-semibold text-text-soft hover:underline">
              Voltar pro login
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
