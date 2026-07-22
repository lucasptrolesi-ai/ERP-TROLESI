"use client";

import { useActionState } from "react";
import Link from "next/link";
import { BrandBadge } from "@/components/brand-badge";
import { FormField } from "@/components/form-field";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-lg">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <BrandBadge variant="gold" size="lg">
            T
          </BrandBadge>
          <h1 className="font-display text-2xl font-semibold text-ink">Trolesi ERP</h1>
          <p className="text-sm text-text-soft">Entre com sua conta da equipe</p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <FormField label="E-mail" name="email" type="email" required autoComplete="email" />
          <FormField
            label="Senha"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />

          {error && (
            <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
          >
            {pending ? "Entrando…" : "Entrar"}
          </button>
          <Link href="/esqueci-senha" className="text-center text-sm font-semibold text-text-soft hover:underline">
            Esqueci minha senha
          </Link>
        </form>
      </div>
    </main>
  );
}
