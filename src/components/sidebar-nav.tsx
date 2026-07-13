"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/", label: "Dashboard", icone: "📊" },
  { href: "/cadastros", label: "Cadastros", icone: "👥" },
  { href: "/estoque", label: "Produtos & Estoque", icone: "💍" },
  { href: "/pedidos", label: "Pedidos", icone: "🧾" },
  { href: "/financeiro", label: "Financeiro", icone: "💰" },
  { href: "/fiscal", label: "Fiscal / NF-e", icone: "🧾" },
];

export function SidebarNav({ onNavegar }: { onNavegar?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {ITENS.map((item) => {
        const ativo = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavegar}
            className={`flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-sm font-medium ${
              ativo
                ? "bg-gradient-to-br from-rose to-rose-deep text-white shadow-md"
                : "text-sidebar-text hover:bg-white/5 hover:text-white"
            }`}
          >
            <span aria-hidden>{item.icone}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
