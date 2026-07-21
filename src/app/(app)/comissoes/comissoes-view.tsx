"use client";

import { useMemo, useState, useTransition } from "react";
import { salvarConfigVendedor, lancarComissao } from "@/lib/actions/comissoes";
import { calcularComissao } from "@/lib/comissao";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso } from "@/lib/datas";
import type { EventoComissao, Vendedor } from "@/lib/types";

type VendedorProfile = { id: string; nome: string; papel: string; ativo: boolean };
type ComissaoLancamento = {
  id: string;
  vendedor_id: string;
  valor_base: number;
  valor_comissao: number;
  evento: string;
  estornado: boolean;
  criado_em: string;
};

const EVENTO_LABEL: Record<EventoComissao, string> = {
  venda: "Na venda",
  recebimento: "No recebimento",
  fechamento_mensal: "No fechamento mensal",
};

export function ComissoesView({
  vendedoresProfiles,
  configs,
  lancamentos,
}: {
  vendedoresProfiles: VendedorProfile[];
  configs: Vendedor[];
  lancamentos: ComissaoLancamento[];
}) {
  const configsPorProfile = useMemo(() => new Map(configs.map((c) => [c.profile_id, c])), [configs]);
  const nomePorVendedorId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of configs) {
      const profile = vendedoresProfiles.find((p) => p.id === c.profile_id);
      if (profile) mapa.set(c.id, profile.nome);
    }
    return mapa;
  }, [configs, vendedoresProfiles]);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-lg font-semibold text-ink">Configuração de comissão por vendedor</h2>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {vendedoresProfiles.map((v) => (
            <LinhaConfigVendedor key={v.id} vendedor={v} config={configsPorProfile.get(v.id) ?? null} />
          ))}
          {vendedoresProfiles.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-text-soft">Nenhum vendedor ativo cadastrado.</p>
          )}
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-lg font-semibold text-ink">Lançamentos recentes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Vendedor</th>
                <th className="px-5 py-2">Evento</th>
                <th className="px-5 py-2">Base</th>
                <th className="px-5 py-2">Comissão</th>
                <th className="px-5 py-2">Data</th>
              </tr>
            </thead>
            <tbody>
              {lancamentos.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-5 py-2.5">{nomePorVendedorId.get(l.vendedor_id) ?? "—"}</td>
                  <td className="px-5 py-2.5">{EVENTO_LABEL[l.evento as EventoComissao] ?? l.evento}</td>
                  <td className="px-5 py-2.5 tabular-nums">{formatarMoeda(l.valor_base)}</td>
                  <td className="px-5 py-2.5 tabular-nums font-semibold text-rose-deep">
                    {formatarMoeda(l.valor_comissao)}
                  </td>
                  <td className="px-5 py-2.5">{formatarDataIso(l.criado_em)}</td>
                </tr>
              ))}
              {lancamentos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhum lançamento de comissão ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {configs.length > 0 && <LancarComissao configs={configs} nomePorVendedorId={nomePorVendedorId} />}
    </div>
  );
}

function LinhaConfigVendedor({ vendedor, config }: { vendedor: VendedorProfile; config: Vendedor | null }) {
  const [percentual, setPercentual] = useState(config?.comissao_percentual != null ? String(config.comissao_percentual) : "");
  const [fixa, setFixa] = useState(config?.comissao_fixa != null ? String(config.comissao_fixa) : "");
  const [evento, setEvento] = useState<EventoComissao>(config?.evento_gerador ?? "venda");
  const [meta, setMeta] = useState(config?.meta_mensal != null ? String(config.meta_mensal) : "");
  const [pending, iniciar] = useTransition();
  const [salvo, setSalvo] = useState(false);

  function salvar() {
    setSalvo(false);
    iniciar(async () => {
      await salvarConfigVendedor(
        vendedor.id,
        percentual ? Number(percentual.replace(",", ".")) : null,
        fixa ? Number(fixa.replace(",", ".")) : null,
        evento,
        meta ? Number(meta.replace(",", ".")) : null,
      );
      setSalvo(true);
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
      <span className="w-40 shrink-0 text-sm font-semibold text-ink">{vendedor.nome}</span>
      <input
        value={percentual}
        onChange={(e) => setPercentual(e.target.value)}
        placeholder="% comissão"
        className="w-28 rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
      />
      <input
        value={fixa}
        onChange={(e) => setFixa(e.target.value)}
        placeholder="Fixa (R$)"
        className="w-28 rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
      />
      <select
        value={evento}
        onChange={(e) => setEvento(e.target.value as EventoComissao)}
        className="rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
      >
        {(Object.entries(EVENTO_LABEL) as [EventoComissao, string][]).map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </select>
      <input
        value={meta}
        onChange={(e) => setMeta(e.target.value)}
        placeholder="Meta mensal (R$)"
        className="w-32 rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={pending}
        onClick={salvar}
        className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Salvando…" : salvo ? "Salvo ✓" : "Salvar"}
      </button>
    </div>
  );
}

function LancarComissao({
  configs,
  nomePorVendedorId,
}: {
  configs: Vendedor[];
  nomePorVendedorId: Map<string, string>;
}) {
  const [vendedorId, setVendedorId] = useState("");
  const [valorBase, setValorBase] = useState("");
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const config = configs.find((c) => c.id === vendedorId) ?? null;
  const previa =
    config && valorBase
      ? calcularComissao(Number(valorBase.replace(",", ".")) || 0, config.comissao_percentual, config.comissao_fixa)
      : 0;

  function lancar() {
    if (!config) {
      setErro("Selecione um vendedor.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await lancarComissao(config.id, Number(valorBase.replace(",", ".")) || 0);
      if (resultado.erro) setErro(resultado.erro);
      else setValorBase("");
    });
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 font-display text-lg font-semibold text-ink">Lançar comissão manualmente</h2>
      <div className="flex flex-wrap items-end gap-3">
        <select
          value={vendedorId}
          onChange={(e) => setVendedorId(e.target.value)}
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
        >
          <option value="">Vendedor…</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {nomePorVendedorId.get(c.id) ?? c.id}
            </option>
          ))}
        </select>
        <input
          value={valorBase}
          onChange={(e) => setValorBase(e.target.value)}
          placeholder="Valor base (R$)"
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
        />
        <span className="text-sm text-text-soft">
          Comissão: <strong className="text-rose-deep">{formatarMoeda(previa)}</strong>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={lancar}
          className="rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Lançando…" : "Lançar"}
        </button>
      </div>
      {erro && <p className="mt-2 text-sm font-medium text-crit">{erro}</p>}
    </div>
  );
}
