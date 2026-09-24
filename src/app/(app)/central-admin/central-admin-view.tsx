"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resolverDecisaoPendente } from "@/lib/actions/central-admin";
import { formatarDataHoraIso } from "@/lib/datas";
import type { DecisaoPendente } from "./page";

const ATALHOS = [
  { href: "/dashboard", icone: "📈", titulo: "Painel Atacado", descricao: "Faturamento, formas de pagamento e produtos" },
  { href: "/varejo/dashboard", icone: "🧮", titulo: "Painel Varejo", descricao: "Vendas, caixa e produtos da loja" },
  { href: "/consolidado", icone: "🧭", titulo: "Painel Consolidado", descricao: "Atacado + Varejo, intercompany eliminado" },
  { href: "/permissoes", icone: "🔑", titulo: "Permissões", descricao: "Funcionários, papéis e acessos especiais" },
];

export function CentralAdminView({ nome, decisoes }: { nome: string; decisoes: DecisaoPendente[] }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Central do Admin</h1>
        <p className="text-sm text-text-soft">Só {nome} vê esta página — atalhos e decisões que só o admin resolve.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ATALHOS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-4 shadow-sm transition-colors hover:border-rose-deep hover:bg-rose-soft/40"
          >
            <span className="text-xl" aria-hidden>
              {a.icone}
            </span>
            <span className="font-display text-base font-semibold text-ink">{a.titulo}</span>
            <span className="text-xs text-text-soft">{a.descricao}</span>
          </Link>
        ))}
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-base font-semibold text-ink">Decisões pendentes</h2>
          <span className="text-xs text-text-soft">{decisoes.length} em aberto</span>
        </div>
        {decisoes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-soft">Nenhuma decisão pendente agora.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {decisoes.map((d) => (
              <LinhaDecisao key={d.id} decisao={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinhaDecisao({ decisao }: { decisao: DecisaoPendente }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, iniciar] = useTransition();

  function resolver() {
    if (texto.trim().length === 0) {
      setErro("Escreva a decisão tomada.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await resolverDecisaoPendente(decisao.chave, texto);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">{decisao.descricao}</span>
          <span className="text-xs text-text-soft">
            {decisao.chave} · pendente desde {formatarDataHoraIso(decisao.criado_em)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="shrink-0 rounded-[10px] border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-cream"
        >
          {aberto ? "Fechar" : "Decidir"}
        </button>
      </div>

      {aberto && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Qual foi a decisão tomada?"
            rows={2}
            className="w-full rounded-[10px] border border-line bg-cream px-3 py-2 text-sm text-ink placeholder:text-text-soft focus:border-rose-deep focus:outline-none"
          />
          {erro && <p className="text-xs font-medium text-crit">{erro}</p>}
          <button
            type="button"
            disabled={pending}
            onClick={resolver}
            className="w-fit rounded-[10px] bg-gradient-to-br from-gold-start to-gold-end px-4 py-1.5 text-xs font-semibold text-gold-ink shadow-sm disabled:opacity-60"
          >
            {pending ? "Registrando…" : "Registrar decisão"}
          </button>
        </div>
      )}
    </div>
  );
}
