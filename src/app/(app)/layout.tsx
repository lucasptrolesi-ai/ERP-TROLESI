import { SidebarNav } from "@/components/sidebar-nav";
import { BrandBadge } from "@/components/brand-badge";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { logout } from "./actions";

const PAPEL_LABEL: Record<string, string> = {
  admin: "Admin",
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await getPerfilAtual();
  const papelLabel = PAPEL_LABEL[perfil.papel] ?? "Sem papel";
  const inicial = perfil.nome.charAt(0).toUpperCase();

  return (
    <div className="grid min-h-screen grid-cols-[246px_1fr]">
      <aside className="flex flex-col gap-7 bg-sidebar p-[1.1rem_1.1rem] text-sidebar-text">
        <div className="flex items-center gap-2.5 px-1">
          <BrandBadge variant="gold">T</BrandBadge>
          <span className="font-display text-xl font-semibold text-[#f3ded6]">Trolesi ERP</span>
        </div>

        <SidebarNav />

        <div className="mt-auto border-t border-white/10 pt-3 text-xs text-text-soft">
          <p className="font-semibold text-sidebar-text">{perfil.nome}</p>
          <p>{papelLabel}</p>
          <form action={logout} className="mt-2">
            <button type="submit" className="text-xs underline decoration-dotted hover:text-white">
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-line bg-surface px-8 py-4">
          <span className="rounded-full bg-rose-soft px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-rose-deep">
            {papelLabel}
          </span>
          <BrandBadge variant="rose">{inicial}</BrandBadge>
        </header>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
