"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Dashboard/Financeiro/Fiscal saem do menu (2026-07-20, fusão com o
// documento mestre do PDV) — o código continua no repositório, só não fica
// mais acessível pela navegação enquanto essas fases não voltam ao roadmap
// reconstruídas (Caixa/Comissões/Relatórios, fases 4/5). PDV (antiga tela
// de Pedidos) vira a tela principal.
const ITENS = [
  { href: "/pedidos", label: "PDV", icone: "🧾" },
  { href: "/cadastros", label: "Cadastros", icone: "👥" },
  { href: "/estoque", label: "Produtos & Estoque", icone: "💍" },
  { href: "/abatimentos", label: "Abatimentos", icone: "♻️" },
  { href: "/garantias", label: "Garantias", icone: "🛡️" },
  { href: "/crediario", label: "Crediário", icone: "💳" },
  { href: "/comissoes", label: "Comissões", icone: "🤝" },
  { href: "/frete", label: "Frete", icone: "📦" },
  { href: "/relatorios", label: "Relatórios", icone: "📊" },
  { href: "/permissoes", label: "Permissões", icone: "🔑" },
];

export function SidebarNav({ onNavegar }: { onNavegar?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {ITENS.map((item) => {
        // "/" redireciona pro PDV — trata como ativo também nesse caso.
        const ativo = pathname.startsWith(item.href) || (item.href === "/pedidos" && pathname === "/");
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
