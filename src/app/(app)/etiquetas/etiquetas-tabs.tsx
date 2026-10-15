import Link from "next/link";

// Módulo Etiquetas (Fase A, 2026-10-15): 3 abas viram rotas de verdade (não useState — cada uma é
// uma página própria, Server Component). "Histórico" ainda não existe (Fase B) — aparece esmaecida
// em vez de um link quebrado, pra não prometer uma tela que ainda não existe.
const ABAS = [
  { href: "/etiquetas", label: "Modelos" },
  { href: "/etiquetas/lote", label: "Imprimir em lote" },
] as const;

export function EtiquetasTabs({ ativo }: { ativo: "modelos" | "lote" }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-lg font-semibold">Etiquetas</h1>
      <div className="flex gap-1">
        {ABAS.map((aba) => {
          const chave = aba.href === "/etiquetas" ? "modelos" : "lote";
          const estaAtivo = chave === ativo;
          return (
            <Link
              key={aba.href}
              href={aba.href}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${estaAtivo ? "bg-rose-soft text-rose-deep" : "text-text-soft hover:text-ink"}`}
            >
              {aba.label}
            </Link>
          );
        })}
        <span className="rounded-lg px-3.5 py-2 text-sm text-text-soft/50" title="Ainda não existe (próxima fase)">
          Histórico
        </span>
      </div>
    </div>
  );
}
