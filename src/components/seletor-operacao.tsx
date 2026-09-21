"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trocarOperacao } from "@/lib/actions/operacao";
import type { OperacaoDoUsuario } from "@/lib/autorizacao/tipos";

/** Mostra a operação atual; com mais de uma operação, permite trocar (o banco valida a troca). */
export function SeletorOperacao({ operacoes, atualId }: { operacoes: OperacaoDoUsuario[]; atualId: string | null }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const atual = operacoes.find((o) => o.id === atualId);
  if (operacoes.length === 0) return null;

  if (operacoes.length === 1) {
    return (
      <span className="hidden rounded-full border border-line px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-text-soft md:inline-flex">
        {atual?.nome ?? operacoes[0].nome}
      </span>
    );
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-text-soft">
      <span className="hidden sm:inline">Operação</span>
      <select
        value={atualId ?? ""}
        disabled={pendente}
        onChange={(e) => {
          const destino = e.target.value;
          setErro(null);
          iniciar(async () => {
            const resultado = await trocarOperacao(destino);
            if (resultado.erro) {
              setErro(resultado.erro);
              return;
            }
            // A tela atual pode não existir na outra operação: volta para a raiz, que redireciona.
            router.push("/");
            router.refresh();
          });
        }}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
      >
        {atualId === null && <option value="">Escolha…</option>}
        {operacoes.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.ativa && false}>
            {o.nome}
            {o.ativa ? "" : " (inativa)"}
          </option>
        ))}
      </select>
      {erro && <span className="text-[0.7rem] text-red-700">{erro}</span>}
    </label>
  );
}
