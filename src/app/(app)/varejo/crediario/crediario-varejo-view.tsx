"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso, hojeIso } from "@/lib/datas";
import { darBaixaEmLoteContasReceber } from "@/lib/actions/financeiro";
import type { ContaReceberVarejo } from "@/lib/varejo/tipos";
import type { FormaPagamento } from "@/lib/types";

const FORMAS_BAIXA: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "cartao_credito", rotulo: "Crédito" },
];

type Filtro = "em_aberto" | "atrasado" | "pago" | "todos";

export function CrediarioVarejoView({ parcelas }: { parcelas: ContaReceberVarejo[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("em_aberto");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [formaBaixa, setFormaBaixa] = useState<FormaPagamento>("dinheiro");
  const [dataBaixa, setDataBaixa] = useState(hojeIso());
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const hoje = hojeIso();
  const visiveis = useMemo(() => {
    if (filtro === "todos") return parcelas;
    if (filtro === "pago") return parcelas.filter((p) => p.situacao === "pago");
    if (filtro === "atrasado") return parcelas.filter((p) => p.situacao !== "pago" && p.vencimento < hoje);
    return parcelas.filter((p) => p.situacao !== "pago");
  }, [parcelas, filtro, hoje]);

  const totalEmAberto = parcelas.filter((p) => p.situacao !== "pago").reduce((s, p) => s + p.valor, 0);
  const totalAtrasado = parcelas.filter((p) => p.situacao !== "pago" && p.vencimento < hoje).reduce((s, p) => s + p.valor, 0);

  function alternar(id: string) {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function marcarComoPago() {
    setErro(null);
    setSucesso(null);
    if (selecionadas.size === 0) {
      setErro("Selecione ao menos uma parcela.");
      return;
    }
    iniciar(async () => {
      const resultado = await darBaixaEmLoteContasReceber(Array.from(selecionadas), {
        pago_em: dataBaixa,
        forma_pagamento: formaBaixa,
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setSucesso(`${selecionadas.size} parcela(s) marcada(s) como paga(s).`);
      setSelecionadas(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-text-soft">Em aberto</p>
          <p className="mt-1 font-display text-2xl font-semibold text-ink">{formatarMoeda(totalEmAberto)}</p>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-text-soft">Atrasado</p>
          <p className={`mt-1 font-display text-2xl font-semibold ${totalAtrasado > 0 ? "text-crit" : "text-ink"}`}>
            {formatarMoeda(totalAtrasado)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["em_aberto", "Em aberto"],
          ["atrasado", "Atrasado"],
          ["pago", "Pago"],
          ["todos", "Todos"],
        ] as [Filtro, string][]).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltro(valor)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              filtro === valor ? "border-rose bg-rose-soft text-rose-deep" : "border-line text-text-soft"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-text-soft">
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Venda</th>
              <th className="px-3 py-2">Parcela</th>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => {
              const atrasada = p.situacao !== "pago" && p.vencimento < hoje;
              return (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    {p.situacao !== "pago" && (
                      <input type="checkbox" checked={selecionadas.has(p.id)} onChange={() => alternar(p.id)} className="h-4 w-4 accent-rose" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink">{p.cliente_nome}</p>
                    {p.cliente_documento && <p className="text-xs text-text-soft">{p.cliente_documento}</p>}
                  </td>
                  <td className="px-3 py-2 text-text-soft">#{p.venda_numero}</td>
                  <td className="px-3 py-2 text-text-soft">
                    {p.numero_parcela && p.total_parcelas ? `${p.numero_parcela}/${p.total_parcelas}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-text-soft">{formatarDataIso(p.vencimento)}</td>
                  <td className="px-3 py-2 font-semibold text-ink">{formatarMoeda(p.valor)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        p.situacao === "pago"
                          ? "bg-ok-bg text-ok"
                          : atrasada
                            ? "bg-crit-bg text-crit"
                            : "bg-warn-bg text-warn"
                      }`}
                    >
                      {p.situacao === "pago" ? "Pago" : atrasada ? "Atrasado" : "Em dia"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-text-soft">
                  Nada aqui.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selecionadas.size > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-cream p-4">
          <label className="flex flex-col gap-1 text-sm">
            Data do pagamento
            <input
              type="date"
              value={dataBaixa}
              max={hojeIso()}
              onChange={(e) => setDataBaixa(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Forma
            <select value={formaBaixa} onChange={(e) => setFormaBaixa(e.target.value as FormaPagamento)} className="rounded-lg border border-line bg-surface px-3 py-2">
              {FORMAS_BAIXA.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.rotulo}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={marcarComoPago}
            disabled={pendente}
            className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2.5 font-semibold text-gold-ink disabled:opacity-60"
          >
            {pendente ? "Salvando…" : `Marcar ${selecionadas.size} como paga(s)`}
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-crit">{erro}</p>}
      {sucesso && <p className="text-sm text-ok">{sucesso}</p>}
    </div>
  );
}
