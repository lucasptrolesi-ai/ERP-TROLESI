"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Dashboard/Fiscal seguem fora do menu (2026-07-20, fusão com o documento
// mestre do PDV) — código mantido no repositório, só não fica acessível
// pela navegação por ora. Financeiro voltou ao menu em 2026-07-22 (pedido
// direto do usuário — precisa de contas a receber completo, dar baixa e
// estornar) — a tela já existia inteira desde antes do pivô, só estava
// desvinculada.
const ITENS = [
  { href: "/pedidos", label: "PDV", icone: "🧾" },
  { href: "/cadastros", label: "Cadastros", icone: "👥" },
  { href: "/estoque", label: "Produtos & Estoque", icone: "💍" },
  { href: "/financeiro", label: "Financeiro", icone: "💰" },
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
                ? "bg-gradient-to-br from-gold-start to-gold-end text-gold-ink shadow-md"
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
