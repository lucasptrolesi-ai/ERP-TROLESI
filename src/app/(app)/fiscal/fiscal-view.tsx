"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso } from "@/lib/datas";
import { gerarNotaFiscal } from "@/lib/actions/fiscal";
import type { NotaFiscal, PedidoPendenteFiscal, StatusNotaFiscal } from "@/lib/types";

const STATUS_LABEL: Record<StatusNotaFiscal, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "bg-line text-text-soft" },
  gerada: { rotulo: "Aguardando conferência", classe: "bg-warn-bg text-warn" },
  validada: { rotulo: "Validada", classe: "bg-ok-bg text-ok" },
  autorizada: { rotulo: "Autorizada", classe: "bg-ok-bg text-ok" },
  cancelada: { rotulo: "Cancelada", classe: "bg-crit-bg text-crit" },
};

export function FiscalView({
  notas,
  pendentes,
}: {
  notas: NotaFiscal[];
  pendentes: PedidoPendenteFiscal[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm text-ink">
          <span className="font-semibold">Modo conferência:</span> as notas geradas aqui são um rascunho pra
          revisão — nada é transmitido à SEFAZ. A emissão real continua pelo GMax até essa etapa ser aprovada.
        </p>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-ink">Pendentes de emissão</h2>
          <p className="text-xs text-text-soft">Pedidos faturados sem nota gerada ainda</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-4 py-2">Pedido</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {pendentes.map((p) => (
                <LinhaPendente key={p.id} pedido={p} />
              ))}
              {pendentes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-text-soft">
                    Nenhum pedido faturado pendente de emissão.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-ink">Notas em conferência</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-4 py-2">Pedido</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">CFOP</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => {
                const status = STATUS_LABEL[n.status];
                return (
                  <tr key={n.id} className="border-t border-line">
                    <td className="px-4 py-2.5">{n.pedidos ? `#${n.pedidos.numero}` : "—"}</td>
                    <td className="px-4 py-2.5">{n.clientes?.razao_social || n.clientes?.nome || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatarMoeda(n.valor_total)}</td>
                    <td className="px-4 py-2.5">{n.cfop}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.classe}`}>
                        {status.rotulo}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a href={`/fiscal/${n.id}/conferencia`} className="text-xs font-semibold text-rose-deep hover:underline">
                        {n.status === "gerada" ? "Conferir" : "Ver"}
                      </a>
                    </td>
                  </tr>
                );
              })}
              {notas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-soft">
                    Nenhuma nota gerada ainda.
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

function LinhaPendente({ pedido }: { pedido: PedidoPendenteFiscal }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function gerar() {
    setErro(null);
    iniciar(async () => {
      const resultado = await gerarNotaFiscal(pedido.id);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
      if (resultado.notaId) router.push(`/fiscal/${resultado.notaId}/conferencia`);
    });
  }

  return (
    <tr className="border-t border-line align-top">
      <td className="px-4 py-2.5">#{pedido.numero}</td>
      <td className="px-4 py-2.5">{pedido.clientes?.razao_social || pedido.clientes?.nome || "—"}</td>
      <td className="px-4 py-2.5">{formatarDataIso(pedido.criado_em)}</td>
      <td className="px-4 py-2.5 tabular-nums">{formatarMoeda(pedido.total)}</td>
      <td className="px-4 py-2.5 text-right">
        <button
          onClick={gerar}
          disabled={pendente}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-3 py-1.5 text-xs font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Gerando…" : "Gerar XML"}
        </button>
        {erro && <p className="mt-1 text-[0.65rem] text-crit">{erro}</p>}
      </td>
    </tr>
  );
}
