"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { ajustarPedido, extornarPedido } from "@/lib/actions/pedidos";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { parseMoeda } from "@/lib/parse-moeda";
import type { Pedido } from "@/lib/types";

export function PedidoDetalhe({
  pedido,
  onFechar,
  podeEditar,
}: {
  pedido: Pedido;
  onFechar: () => void;
  podeEditar: boolean;
}) {
  const [valorDesconto, setValorDesconto] = useState(String(pedido.valor_desconto));
  const [valorAcrescimo, setValorAcrescimo] = useState(String(pedido.valor_acrescimo));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();
  const [extornando, iniciarEstorno] = useTransition();

  const numDesconto = parseMoeda(valorDesconto);
  const numAcrescimo = parseMoeda(valorAcrescimo);
  const totalRecalculado = Math.max(0, pedido.subtotal - numDesconto + numAcrescimo);
  const cancelado = pedido.status === "cancelado";
  const editavel = podeEditar && !cancelado;

  function salvarAjuste() {
    setErro(null);
    iniciarSalvamento(async () => {
      const resultado = await ajustarPedido(pedido.id, numDesconto, numAcrescimo);
      if (resultado.erro) setErro(resultado.erro);
      else onFechar();
    });
  }

  function extornar() {
    if (!confirm(`Extornar o pedido #${pedido.numero}? Isso cancela o pedido e devolve o estoque, se já tiver sido faturado. Não pode ser desfeito.`)) {
      return;
    }
    setErro(null);
    iniciarEstorno(async () => {
      const resultado = await extornarPedido(pedido.id);
      if (resultado.erro) setErro(resultado.erro);
      else onFechar();
    });
  }

  return (
    <Modal aberto onFechar={onFechar} titulo={`Pedido #${pedido.numero}`}>
      <div className="flex flex-col gap-4">
        <div className="text-sm text-text-soft">
          <p>Cliente: <span className="text-ink">{pedido.clientes?.nome ?? "—"}</span></p>
          <p>Data: <span className="text-ink">{new Date(pedido.criado_em).toLocaleString("pt-BR")}</span></p>
        </div>

        <div className="rounded-lg border border-line">
          <table className="w-full text-sm">
            <tbody>
              {pedido.pedido_itens.map((item, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-2 py-1.5">
                    {item.quantidade}x {item.produtos?.nome ?? "Produto"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatarMoeda(item.quantidade * item.preco_unitario)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-text-soft">Subtotal</span>
          <span className="tabular-nums">{formatarMoeda(pedido.subtotal)}</span>
        </div>

        {editavel ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] text-text-soft">Desconto (R$)</label>
              <input
                value={valorDesconto}
                onChange={(e) => setValorDesconto(e.target.value)}
                className="rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] text-text-soft">Acréscimo (R$)</label>
              <input
                value={valorAcrescimo}
                onChange={(e) => setValorAcrescimo(e.target.value)}
                className="rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        ) : (
          <>
            {pedido.valor_desconto > 0 && (
              <div className="flex justify-between text-sm text-ok">
                <span>Desconto</span>
                <span className="tabular-nums">− {formatarMoeda(pedido.valor_desconto)}</span>
              </div>
            )}
            {pedido.valor_acrescimo > 0 && (
              <div className="flex justify-between text-sm text-warn">
                <span>Acréscimo</span>
                <span className="tabular-nums">+ {formatarMoeda(pedido.valor_acrescimo)}</span>
              </div>
            )}
          </>
        )}

        <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-semibold text-rose-deep">
          <span>Total</span>
          <span className="tabular-nums">
            {formatarMoeda(editavel ? totalRecalculado : pedido.total)}
          </span>
        </div>

        {erro && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {erro}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <a
            href={`/pedidos/${pedido.id}/cupom`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
          >
            🧾 Cupom
          </a>
          {pedido.forma_pagamento === "promissoria" && (
            <a
              href={`/pedidos/${pedido.id}/promissorias`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
            >
              📄 Promissórias
            </a>
          )}
        </div>

        {editavel && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={extornar}
              disabled={extornando}
              className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-crit disabled:opacity-60"
            >
              {extornando ? "Extornando…" : "Extornar pedido"}
            </button>
            <button
              type="button"
              onClick={salvarAjuste}
              disabled={salvando}
              className="flex-1 rounded-full bg-gradient-to-br from-rose to-rose-deep py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {salvando ? "Salvando…" : "Salvar ajuste"}
            </button>
          </div>
        )}
        {cancelado && (
          <p className="text-center text-sm font-semibold text-crit">Este pedido foi cancelado/extornado.</p>
        )}
      </div>
    </Modal>
  );
}
