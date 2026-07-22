"use client";

import { useActionState, useState, useTransition } from "react";
import { criarExpedicao, avancarStatusExpedicao } from "@/lib/actions/expedicoes";
import { formatarMoeda } from "@/lib/formatar-moeda";
import type { Expedicao } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  aguardando_separacao: "Aguardando separação",
  em_separacao: "Em separação",
  pronto_para_envio: "Pronto pra envio",
  postado: "Postado",
  em_transporte: "Em transporte",
  entregue: "Entregue",
  devolvido: "Devolvido",
  problema_transporte: "Problema no transporte",
};

type PedidoPendente = { id: string; numero: number; total: number; clientes: { nome: string } | null };

export function FreteView({ expedicoes, pendentes }: { expedicoes: Expedicao[]; pendentes: PedidoPendente[] }) {
  const [state, formAction, pending] = useActionState(criarExpedicao, undefined);
  const [pedidoSelecionado, setPedidoSelecionado] = useState<PedidoPendente | null>(null);
  const [freteGratis, setFreteGratis] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Nova expedição</h2>
        <form action={formAction} className="flex flex-col gap-4">
          <select
            name="pedido_id"
            required
            onChange={(e) => setPedidoSelecionado(pendentes.find((p) => p.id === e.target.value) ?? null)}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          >
            <option value="">Pedido…</option>
            {pendentes.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.numero} — {p.clientes?.nome ?? "—"} ({formatarMoeda(p.total)})
              </option>
            ))}
          </select>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input name="destinatario" placeholder="Destinatário" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink" />
            <input name="transportadora" placeholder="Transportadora/Correios" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink" />
          </div>
          <input name="endereco_entrega" placeholder="Endereço de entrega" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input name="modalidade" placeholder="Modalidade (PAC, SEDEX...)" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink" />
            <input
              name="custo"
              placeholder="Custo do frete (R$)"
              disabled={freteGratis}
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink disabled:opacity-60"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="frete_gratis"
              checked={freteGratis}
              onChange={(e) => setFreteGratis(e.target.checked)}
              className="h-4 w-4 accent-rose"
            />
            Frete grátis (concessão manual — exige motivo)
            {pedidoSelecionado && (
              <span className="text-xs text-text-soft">
                {pedidoSelecionado.total >= 700
                  ? `pedido de ${formatarMoeda(pedidoSelecionado.total)} já libera frete grátis automaticamente (≥ R$700) — marque aqui só pra conceder abaixo do mínimo`
                  : `pedido de ${formatarMoeda(pedidoSelecionado.total)} — abaixo de R$700, frete grátis só manual`}
              </span>
            )}
          </label>
          {freteGratis && (
            <input
              name="motivo_frete_gratis"
              placeholder="Motivo do frete grátis"
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
            />
          )}

          {state?.erro && <p className="text-sm font-medium text-crit">{state.erro}</p>}

          <button
            type="submit"
            disabled={pending}
            className="self-end rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
          >
            {pending ? "Criando…" : "Criar expedição"}
          </button>
        </form>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Pedido</th>
                <th className="px-5 py-2">Transportadora</th>
                <th className="px-5 py-2">Frete</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {expedicoes.map((e) => (
                <LinhaExpedicao key={e.id} expedicao={e} />
              ))}
              {expedicoes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhuma expedição criada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LinhaExpedicao({ expedicao: e }: { expedicao: Expedicao }) {
  const [pending, iniciar] = useTransition();
  const proximoDisponivel = ["aguardando_separacao", "em_separacao", "pronto_para_envio", "postado", "em_transporte"].includes(
    e.status,
  );

  return (
    <tr className="border-t border-line">
      <td className="px-5 py-2.5">
        #{e.pedidos?.numero ?? "—"} — {e.pedidos?.clientes?.nome ?? "—"}
      </td>
      <td className="px-5 py-2.5">{e.transportadora ?? "—"}</td>
      <td className="px-5 py-2.5 tabular-nums">{e.frete_gratis ? "Grátis" : formatarMoeda(e.custo)}</td>
      <td className="px-5 py-2.5">
        <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold text-text-soft">
          {STATUS_LABEL[e.status] ?? e.status}
        </span>
      </td>
      <td className="px-5 py-2.5 text-right">
        {proximoDisponivel && (
          <button
            type="button"
            disabled={pending}
            onClick={() => iniciar(async () => { await avancarStatusExpedicao(e.id, e.status); })}
            className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink disabled:opacity-60"
          >
            Avançar status
          </button>
        )}
      </td>
    </tr>
  );
}
