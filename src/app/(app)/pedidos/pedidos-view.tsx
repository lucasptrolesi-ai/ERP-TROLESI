"use client";

import { useMemo, useState } from "react";
import { NovoPedido } from "./novo-pedido";
import { PedidoDetalhe } from "./pedido-detalhe";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { podeEditarPedidos } from "@/lib/permissoes";
import { STATUS_LABEL } from "@/lib/status-pedido";
import type { Cliente, Pedido, Produto } from "@/lib/types";

export function PedidosView({
  papelAtual,
  pedidos,
  clientes,
  produtos,
}: {
  papelAtual: string;
  pedidos: Pedido[];
  clientes: Cliente[];
  produtos: Produto[];
}) {
  const [aba, setAba] = useState<"lista" | "novo">("lista");
  const [busca, setBusca] = useState("");
  const [pedidoAberto, setPedidoAberto] = useState<Pedido | null>(null);
  const podeCriar = podeEditarPedidos(papelAtual);

  const pedidosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return pedidos;
    return pedidos.filter(
      (p) => String(p.numero).includes(termo) || (p.clientes?.nome ?? "").toLowerCase().includes(termo),
    );
  }, [pedidos, busca]);

  return (
    <div className="rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-line px-4 sm:px-5">
        <div className="flex gap-6">
          <button
            onClick={() => setAba("lista")}
            className={`border-b-2 py-3 text-sm font-semibold ${
              aba === "lista" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Todos os pedidos
          </button>
          {podeCriar && (
            <button
              onClick={() => setAba("novo")}
              className={`border-b-2 py-3 text-sm font-semibold ${
                aba === "novo" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
              }`}
            >
              + Novo pedido
            </button>
          )}
        </div>
      </div>

      {aba === "lista" && (
        <div>
          <div className="px-4 py-4 sm:px-5">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nº do pedido ou cliente"
              className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                  <th className="px-5 py-2">Pedido</th>
                  <th className="px-5 py-2">Cliente</th>
                  <th className="px-5 py-2">Data</th>
                  <th className="px-5 py-2">Itens</th>
                  <th className="px-5 py-2">Total</th>
                  <th className="px-5 py-2">Pagamento</th>
                  <th className="px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.map((p) => {
                  const status = STATUS_LABEL[p.status] ?? {
                    rotulo: p.status,
                    classe: "bg-line text-text-soft",
                  };
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setPedidoAberto(p)}
                      className="cursor-pointer border-t border-line hover:bg-cream"
                    >
                      <td className="px-5 py-2.5">#{p.numero}</td>
                      <td className="px-5 py-2.5">{p.clientes?.nome ?? "—"}</td>
                      <td className="px-5 py-2.5">
                        {new Date(p.criado_em).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-5 py-2.5 tabular-nums">
                        {p.pedido_itens.reduce((soma, i) => soma + i.quantidade, 0)}
                      </td>
                      <td className="px-5 py-2.5 tabular-nums">{formatarMoeda(p.total)}</td>
                      <td className="px-5 py-2.5">
                        {p.forma_pagamento ? FORMA_LABEL[p.forma_pagamento] : "—"}
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${status.classe}`}
                        >
                          {status.rotulo}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {pedidosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-sm text-text-soft">
                      Nenhum pedido encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === "novo" && podeCriar && (
        <NovoPedido clientes={clientes} produtos={produtos} onVoltarParaLista={() => setAba("lista")} />
      )}

      {pedidoAberto && (
        <PedidoDetalhe
          pedido={pedidoAberto}
          onFechar={() => setPedidoAberto(null)}
          podeEditar={podeCriar}
        />
      )}
    </div>
  );
}
