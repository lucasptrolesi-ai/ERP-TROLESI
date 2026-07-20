"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { registrarAbatimento, aprovarAbatimento, reprovarAbatimento } from "@/lib/actions/abatimentos";
import { avaliarPecaParaAbatimento, limiteAbatimento } from "@/lib/abatimento";
import { formatarMoeda } from "@/lib/formatar-moeda";
import type { Abatimento, Cliente } from "@/lib/types";

const STATUS_LABEL: Record<string, { rotulo: string; classe: string }> = {
  avaliando: { rotulo: "Avaliando", classe: "bg-warn-bg text-warn" },
  aprovado: { rotulo: "Aprovado", classe: "bg-ok-bg text-ok" },
  reprovado: { rotulo: "Reprovado", classe: "bg-crit-bg text-crit" },
  vinculado: { rotulo: "Vinculado à venda", classe: "bg-line text-text-soft" },
};

export function AbatimentosView({ abatimentos, clientes }: { abatimentos: Abatimento[]; clientes: Cliente[] }) {
  const [state, formAction, pending] = useActionState(registrarAbatimento, undefined);
  const [busca, setBusca] = useState("");

  const [material, setMaterial] = useState("");
  const [danificada, setDanificada] = useState(false);
  const [marcaPresente, setMarcaPresente] = useState(true);
  const [temPedra, setTemPedra] = useState(false);
  const [temPerola, setTemPerola] = useState(false);
  const [ehFitaOuFio, setEhFitaOuFio] = useState(false);
  const [ultimaColecao, setUltimaColecao] = useState(false);
  const [ehRelogio, setEhRelogio] = useState(false);
  const [baseElegivel, setBaseElegivel] = useState("0");

  const previaAvaliacao = useMemo(
    () =>
      avaliarPecaParaAbatimento({
        material,
        danificada,
        marcaPresente,
        temPedra,
        temPerola,
        ehFitaOuFio,
        ultimaColecao,
        ehRelogio,
      }),
    [material, danificada, marcaPresente, temPedra, temPerola, ehFitaOuFio, ultimaColecao, ehRelogio],
  );

  const baseNum = Number(baseElegivel.replace(",", ".")) || 0;
  const limite = limiteAbatimento(baseNum);

  const abatimentosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return abatimentos;
    return abatimentos.filter((a) => (a.clientes?.nome ?? "").toLowerCase().includes(termo));
  }, [abatimentos, busca]);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Nova avaliação de abatimento</h2>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Cliente</label>
              <select
                name="cliente_id"
                required
                className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
              >
                <option value="">Selecione…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Tipo de peça</label>
              <input
                name="tipo_peca"
                className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
                placeholder="Anel, corrente, brinco…"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Material</label>
            <input
              name="material"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
              placeholder="Ouro 18k, prata 925…"
            />
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
            {(
              [
                ["danificada", "Danificada", danificada, setDanificada],
                ["marca_presente", "Marca presente", marcaPresente, setMarcaPresente],
                ["tem_pedra", "Tem pedra", temPedra, setTemPedra],
                ["tem_perola", "Tem pérola", temPerola, setTemPerola],
                ["eh_fita_ou_fio", "É fita/fio", ehFitaOuFio, setEhFitaOuFio],
                ["ultima_colecao", "Última coleção", ultimaColecao, setUltimaColecao],
                ["eh_relogio", "É relógio", ehRelogio, setEhRelogio],
              ] as const
            ).map(([campo, rotulo, valor, setValor]) => (
              <label key={campo} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name={campo}
                  checked={valor}
                  onChange={(e) => setValor(e.target.checked)}
                  className="h-4 w-4 accent-rose"
                />
                {rotulo}
              </label>
            ))}
          </div>

          <div
            className={`rounded-lg border p-3 text-sm ${
              previaAvaliacao.elegivel ? "border-ok bg-ok-bg text-ok" : "border-crit bg-crit-bg text-crit"
            }`}
          >
            {previaAvaliacao.elegivel
              ? "✓ Peça elegível para abatimento."
              : `✕ Peça inelegível: ${previaAvaliacao.motivo}`}
          </div>

          {previaAvaliacao.elegivel && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
                  Base elegível da compra (R$)
                </label>
                <input
                  name="base_elegivel"
                  value={baseElegivel}
                  onChange={(e) => setBaseElegivel(e.target.value)}
                  className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
                />
                <p className="text-[0.7rem] text-text-soft">
                  Mínimo R$800 · limite de abatimento: {formatarMoeda(limite)}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
                  Valor atribuído (R$)
                </label>
                <input
                  name="valor_atribuido"
                  className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
              Estado da peça (observações)
            </label>
            <input name="estado_descricao" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink" />
          </div>

          {state?.erro && (
            <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
              {state.erro}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="self-end rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Registrar avaliação"}
          </button>
        </form>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente"
            className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Cliente</th>
                <th className="px-5 py-2">Material</th>
                <th className="px-5 py-2">Valor</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {abatimentosFiltrados.map((a) => (
                <LinhaAbatimento key={a.id} abatimento={a} />
              ))}
              {abatimentosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhum abatimento registrado ainda.
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

function LinhaAbatimento({ abatimento }: { abatimento: Abatimento }) {
  const [pending, iniciar] = useTransition();
  const status = STATUS_LABEL[abatimento.status] ?? { rotulo: abatimento.status, classe: "bg-line text-text-soft" };

  return (
    <tr className="border-t border-line">
      <td className="px-5 py-2.5">{abatimento.clientes?.nome ?? "—"}</td>
      <td className="px-5 py-2.5">{abatimento.material ?? "—"}</td>
      <td className="px-5 py-2.5 tabular-nums">
        {abatimento.valor_atribuido != null ? formatarMoeda(abatimento.valor_atribuido) : "—"}
      </td>
      <td className="px-5 py-2.5">
        <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${status.classe}`}>{status.rotulo}</span>
      </td>
      <td className="px-5 py-2.5 text-right">
        {abatimento.status === "avaliando" && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                iniciar(async () => {
                  await aprovarAbatimento(abatimento.id);
                })
              }
              className="rounded-full border border-ok px-3 py-1 text-xs font-semibold text-ok disabled:opacity-60"
            >
              Aprovar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                iniciar(async () => {
                  await reprovarAbatimento(abatimento.id);
                })
              }
              className="rounded-full border border-crit px-3 py-1 text-xs font-semibold text-crit disabled:opacity-60"
            >
              Reprovar
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
