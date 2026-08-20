"use client";

import { useMemo } from "react";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataHoraIso } from "@/lib/datas";
import { FORMA_LABEL_EVENTO, FORMAS_PAGAMENTO_EVENTO } from "@/lib/forma-pagamento-evento";
import type { ProdutoEvento, VendaEvento } from "@/lib/types";

export function ResumoEvento({
  vendasEvento,
  produtosEvento,
}: {
  vendasEvento: VendaEvento[];
  produtosEvento: ProdutoEvento[];
}) {
  const resumo = useMemo(() => {
    const totalVendido = vendasEvento.reduce((s, v) => s + v.total, 0);
    const pecasVendidas = vendasEvento.reduce(
      (s, v) => s + v.vendas_evento_itens.reduce((s2, i) => s2 + i.quantidade, 0),
      0,
    );
    const porFormaPagamento = FORMAS_PAGAMENTO_EVENTO.map((forma) => ({
      forma,
      total: vendasEvento.filter((v) => v.forma_pagamento === forma).reduce((s, v) => s + v.total, 0),
    }));
    const maiorValor = Math.max(1, ...porFormaPagamento.map((f) => f.total));

    // Só peças ativas — mesmo critério de venda (produtosPorCodigo em
    // vender-evento.tsx) — peça inativa não está mais disponível pra vender,
    // não faz sentido contar no valor "em estoque".
    const ativos = produtosEvento.filter((p) => p.ativo);
    const valorEmEstoque = ativos.reduce((s, p) => s + p.preco * p.quantidade_estoque, 0);
    const pecasEmEstoque = ativos.reduce((s, p) => s + p.quantidade_estoque, 0);

    return {
      totalVendido,
      pecasVendidas,
      vendas: vendasEvento.length,
      porFormaPagamento,
      maiorValor,
      valorEmEstoque,
      pecasEmEstoque,
    };
  }, [vendasEvento, produtosEvento]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total vendido" valor={formatarMoeda(resumo.totalVendido)} nota={`${resumo.vendas} venda(s)`} />
        <KpiCard label="Peças vendidas" valor={String(resumo.pecasVendidas)} nota="unidades no total" />
        <KpiCard label="Ticket médio" valor={formatarMoeda(resumo.vendas > 0 ? resumo.totalVendido / resumo.vendas : 0)} nota="por venda" />
        <KpiCard
          label="Valor em estoque"
          valor={formatarMoeda(resumo.valorEmEstoque)}
          nota={`${resumo.pecasEmEstoque} peça(s) ativa(s), a preço de venda`}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-base font-semibold text-ink">Por forma de pagamento</h2>
        <div className="mt-3 flex flex-col gap-2.5">
          {resumo.porFormaPagamento.map(({ forma, total }) => (
            <div key={forma} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-sm font-semibold text-ink">{FORMA_LABEL_EVENTO[forma]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-rose-soft">
                <div
                  className="h-full rounded-full bg-rose-deep"
                  style={{ width: `${(total / resumo.maiorValor) * 100}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-ink">
                {formatarMoeda(total)}
              </span>
            </div>
          ))}
        </div>
        {resumo.vendas === 0 && <p className="mt-2 text-sm text-text-soft">Nenhuma venda registrada ainda.</p>}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-base font-semibold text-ink">Vendas realizadas</h2>
        <div className="mt-3 flex flex-col gap-2">
          {vendasEvento.map((v) => (
            <div key={v.id} className="flex flex-col gap-1 rounded-lg border border-line p-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-bold text-ink">Venda #{v.numero}</span>
                  <span className="text-xs text-text-soft">{formatarDataHoraIso(v.criado_em)}</span>
                  {v.cliente_nome && <span className="text-xs font-semibold text-rose-deep">{v.cliente_nome}</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-text-soft">
                  {v.vendas_evento_itens.map((i) => `${i.quantidade}x ${i.nome}`).join(", ")}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-xs text-text-soft">{FORMA_LABEL_EVENTO[v.forma_pagamento]}</p>
                <p className="text-sm font-bold tabular-nums text-ink">{formatarMoeda(v.total)}</p>
              </div>
            </div>
          ))}
          {resumo.vendas === 0 && <p className="text-sm text-text-soft">Nenhuma venda registrada ainda.</p>}
        </div>
      </div>
    </div>
  );
}
