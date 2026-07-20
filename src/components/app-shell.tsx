"use client";

import { useState } from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { BrandBadge } from "@/components/brand-badge";
import { AlertaVencimentos } from "@/components/alerta-vencimentos";
import { logout } from "@/lib/actions/auth";
import type { ContaPagarVencendo, ParcelaVencendo } from "@/lib/types";

export function AppShell({
  nome,
  papelLabel,
  inicial,
  parcelasVencendo,
  contasPagarVencendo,
  children,
}: {
  nome: string;
  papelLabel: string;
  inicial: string;
  parcelasVencendo: ParcelaVencendo[];
  contasPagarVencendo: ContaPagarVencendo[];
  children: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="min-h-screen print:block md:grid md:grid-cols-[246px_1fr] print:md:grid-cols-1">
      {menuAberto && (
        <button
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        style={{ background: "linear-gradient(180deg, var(--color-sidebar) 0%, var(--color-sidebar-to) 100%)" }}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col gap-7 p-[1.1rem] text-sidebar-text transition-transform duration-200 print:hidden md:static md:z-auto md:w-auto md:translate-x-0 ${
          menuAberto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-1">
          <BrandBadge variant="gold">T</BrandBadge>
          <span className="font-display text-xl font-semibold text-[#f3ded6]">Trolesi ERP</span>
        </div>

        <SidebarNav onNavegar={() => setMenuAberto(false)} />

        <div className="mt-auto border-t border-white/10 pt-3 text-xs text-text-soft">
          <p className="font-semibold text-sidebar-text">{nome}</p>
          <p>{papelLabel}</p>
          <form action={logout} className="mt-2">
            <button type="submit" className="text-xs underline decoration-dotted hover:text-white">
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 print:hidden md:justify-end md:px-8 md:py-4">
          <button
            onClick={() => setMenuAberto(true)}
            aria-label="Abrir menu"
            className="text-xl text-ink md:hidden"
          >
            ☰
          </button>
          <div className="flex items-center gap-3">
            <AlertaVencimentos parcelasReceber={parcelasVencendo} contasPagar={contasPagarVencendo} />
            <span className="rounded-full bg-rose-soft px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-rose-deep">
              {papelLabel}
            </span>
            <BrandBadge variant="rose">{inicial}</BrandBadge>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 print:p-0 md:p-8">{children}</main>
      </div>
    </div>
  );
}
