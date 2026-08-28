"use client";

import { useRef, useState, useTransition } from "react";
import { useMemo } from "react";
import { KpiCard } from "@/components/kpi-card";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataHoraIso } from "@/lib/datas";
import { FORMA_LABEL_EVENTO, FORMAS_PAGAMENTO_EVENTO } from "@/lib/forma-pagamento-evento";
import { extornarVendaEvento } from "@/lib/actions/pdv-eventos";
import { PainelMetas } from "./painel-metas";
import type { ProdutoEvento, VendaEvento } from "@/lib/types";

export function ResumoEvento({
  vendasEvento,
  produtosEvento,
}: {
  vendasEvento: VendaEvento[];
  produtosEvento: ProdutoEvento[];
}) {
  const [erroExtorno, setErroExtorno] = useState<string | null>(null);
  const [, iniciarExtorno] = useTransition();
  // Trava síncrona contra duplo-clique, mesmo padrão já usado em
  // estoque-evento.tsx pra impressão de etiqueta — o `disabled` só reflete
  // o estado depois de um re-render.
  const idsEmExtornoRef = useRef<Set<string>>(new Set());
  const [pendentes, setPendentes] = useState<Set<string>>(new Set());

  function handleExtornar(venda: VendaEvento) {
    if (idsEmExtornoRef.current.has(venda.id)) return;
    if (!confirm(`Extornar a venda #${venda.numero}? As peças voltam pro estoque do evento — não pode ser desfeito.`)) {
      return;
    }
    idsEmExtornoRef.current.add(venda.id);
    setPendentes((atual) => new Set(atual).add(venda.id));
    setErroExtorno(null);
    iniciarExtorno(async () => {
      const resultado = await extornarVendaEvento(venda.id);
      idsEmExtornoRef.current.delete(venda.id);
      setPendentes((atual) => {
        const novo = new Set(atual);
        novo.delete(venda.id);
        return novo;
      });
      if (resultado.erro) setErroExtorno(resultado.erro);
    });
  }

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

    // Valor médio por PEÇA vendida (não confundir com o "Ticket médio", que
    // é por VENDA/transação) — soma o que entrou em dinheiro dividido pela
    // quantidade de peças, não pelo número de vendas.
    const ticketMedioPeca = pecasVendidas > 0 ? totalVendido / pecasVendidas : 0;

    // Preço médio do CATÁLOGO — média do preço cadastrado em cada peça
    // (todas, ativas ou não, mesmo universo do card "Peças cadastradas"),
    // sem relação nenhuma com venda.
    const precoMedioCadastrado =
      produtosEvento.length > 0
        ? produtosEvento.reduce((s, p) => s + p.preco, 0) / produtosEvento.length
        : 0;

    return {
      totalVendido,
      pecasVendidas,
      vendas: vendasEvento.length,
      porFormaPagamento,
      maiorValor,
      valorEmEstoque,
      pecasEmEstoque,
      ticketMedioPeca,
      precoMedioCadastrado,
    };
  }, [vendasEvento, produtosEvento]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <PainelMetas vendasEvento={vendasEvento} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Peças cadastradas"
          valor={String(produtosEvento.length)}
          nota={`${resumo.pecasEmEstoque} unidade(s) ativa(s) em estoque`}
        />
        <KpiCard label="Total vendido" valor={formatarMoeda(resumo.totalVendido)} nota={`${resumo.vendas} venda(s)`} />
        <KpiCard label="Peças vendidas" valor={String(resumo.pecasVendidas)} nota="unidades no total" />
        <KpiCard label="Ticket médio" valor={formatarMoeda(resumo.vendas > 0 ? resumo.totalVendido / resumo.vendas : 0)} nota="por venda" />
        <KpiCard label="Ticket médio da peça" valor={formatarMoeda(resumo.ticketMedioPeca)} nota="valor médio por peça vendida" />
        <KpiCard
          label="Preço médio do catálogo"
          valor={formatarMoeda(resumo.precoMedioCadastrado)}
          nota="média entre todas as peças cadastradas"
        />
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
        {erroExtorno && (
          <p role="alert" className="mt-2 rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {erroExtorno}
          </p>
        )}
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
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-left sm:text-right">
                  <p className="text-xs text-text-soft">{FORMA_LABEL_EVENTO[v.forma_pagamento]}</p>
                  <p className="text-sm font-bold tabular-nums text-ink">{formatarMoeda(v.total)}</p>
                </div>
                <button
                  onClick={() => handleExtornar(v)}
                  disabled={pendentes.has(v.id)}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-crit disabled:opacity-60"
                >
                  {pendentes.has(v.id) ? "Extornando…" : "Extornar"}
                </button>
              </div>
            </div>
          ))}
          {resumo.vendas === 0 && <p className="text-sm text-text-soft">Nenhuma venda registrada ainda.</p>}
        </div>
      </div>
    </div>
  );
}
