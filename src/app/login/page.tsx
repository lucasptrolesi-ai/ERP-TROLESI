"use client";

import { useActionState } from "react";
import { BrandBadge } from "@/components/brand-badge";
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-full bg-gradient-to-br from-rose to-rose-deep py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
          >
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
