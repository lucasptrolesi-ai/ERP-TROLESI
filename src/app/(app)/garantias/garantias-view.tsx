"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { registrarGarantia, decidirGarantia } from "@/lib/actions/garantias";
import { avaliarGarantiaFolheado } from "@/lib/garantia";
import type { Cliente, Garantia, GarantiaProdutoTipo, Produto } from "@/lib/types";

const TIPO_LABEL: Record<GarantiaProdutoTipo, string> = {
  sem_garantia: "Sem garantia",
  folheado_ouro: "Folheado a ouro",
  autenticidade_prata_aco: "Autenticidade (prata 925 / aço cirúrgico)",
  orient: "Relógio Orient",
};

export function GarantiasView({
  garantias,
  clientes,
  produtos,
  podeAprovar,
}: {
  garantias: Garantia[];
  clientes: Cliente[];
  produtos: Produto[];
  podeAprovar: boolean;
}) {
  const [state, formAction, pending] = useActionState(registrarGarantia, undefined);
  const [tipo, setTipo] = useState<GarantiaProdutoTipo>("folheado_ouro");

  const [percentual, setPercentual] = useState("0");
  const [marcaPresente, setMarcaPresente] = useState(true);
  const [pecaCompleta, setPecaCompleta] = useState(true);
  const [alianca, setAlianca] = useState(false);

  const previaFolheado = useMemo(
    () =>
      avaliarGarantiaFolheado({
        percentualDescascamento: Number(percentual.replace(",", ".")) || 0,
        marcaPresente,
        pecaCompleta,
        alianca,
      }),
    [percentual, marcaPresente, pecaCompleta, alianca],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Nova análise de garantia</h2>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Cliente</label>
              <select name="cliente_id" required className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink">
                <option value="">Selecione…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Produto</label>
              <select name="produto_id" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Tipo de garantia</label>
              <select
                name="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as GarantiaProdutoTipo)}
                className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
              >
                {(Object.entries(TIPO_LABEL) as [GarantiaProdutoTipo, string][])
                  .filter(([valor]) => valor !== "sem_garantia")
                  .map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {tipo === "folheado_ouro" && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
                    % descascamento estimado
                  </label>
                  <input
                    name="percentual_descascamento"
                    value={percentual}
                    onChange={(e) => setPercentual(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="marca_presente"
                    checked={marcaPresente}
                    onChange={(e) => setMarcaPresente(e.target.checked)}
                    className="h-4 w-4 accent-rose"
                  />
                  Marca presente
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="peca_completa"
                    checked={pecaCompleta}
                    onChange={(e) => setPecaCompleta(e.target.checked)}
                    className="h-4 w-4 accent-rose"
                  />
                  Peça completa
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="alianca"
                    checked={alianca}
                    onChange={(e) => setAlianca(e.target.checked)}
                    className="h-4 w-4 accent-rose"
                  />
                  É aliança
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="limpeza_realizada" className="h-4 w-4 accent-rose" />
                Limpeza realizada antes da decisão final
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="sinais_mau_uso" className="h-4 w-4 accent-rose" />
                Sinais de mau uso
              </label>
              <div
                className={`rounded-lg border p-3 text-sm ${
                  previaFolheado.aprovado ? "border-ok bg-ok-bg text-ok" : "border-crit bg-crit-bg text-crit"
                }`}
              >
                {previaFolheado.aprovado ? "✓ Garantia aprovada pela regra." : `✕ Reprovada: ${previaFolheado.motivo}`}
              </div>
            </div>
          )}

          {tipo === "autenticidade_prata_aco" && (
            <p className="rounded-lg border border-line bg-cream p-3 text-sm text-text-soft">
              Garantia classificada como <strong>autenticidade do material apenas</strong> — não cobre risco, quebra,
              amassado, desgaste, escurecimento, sujeira, falta de manutenção, mau uso ou perda de componente.
            </p>
          )}

          {tipo === "orient" && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream p-3">
              <p className="text-sm text-text-soft">
                A decisão técnica pertence à <strong>fabricante (Orient)</strong>, não à loja. Prazo informado: 1 ano,
                respeitando as regras do fabricante.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Nº de série</label>
                <input name="numero_serie" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Parecer</label>
            <input name="parecer" className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink" />
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
            {pending ? "Salvando…" : "Registrar análise"}
          </button>
        </form>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Cliente</th>
                <th className="px-5 py-2">Produto</th>
                <th className="px-5 py-2">Tipo</th>
                <th className="px-5 py-2">Resultado</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {garantias.map((g) => (
                <LinhaGarantia key={g.id} garantia={g} podeAprovar={podeAprovar} />
              ))}
              {garantias.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-soft">
                    Nenhuma garantia registrada ainda.
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

function LinhaGarantia({ garantia: g, podeAprovar }: { garantia: Garantia; podeAprovar: boolean }) {
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function decidir(aprovado: boolean) {
    const justificativa = prompt(
      `Justificativa pra ${aprovado ? "aprovar" : "reprovar"} essa garantia (fica registrada na auditoria):`,
    );
    if (justificativa === null) return;
    setErro(null);
    iniciar(async () => {
      const resultado = await decidirGarantia(g.id, aprovado, justificativa);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <tr className="border-t border-line">
      <td className="px-5 py-2.5">{g.clientes?.nome ?? "—"}</td>
      <td className="px-5 py-2.5">{g.produtos?.nome ?? "—"}</td>
      <td className="px-5 py-2.5">{TIPO_LABEL[g.tipo]}</td>
      <td className="px-5 py-2.5">
        {g.tipo === "orient" && g.aprovado === null ? (
          <span className="rounded-full bg-warn-bg px-2.5 py-1 text-xs font-bold text-warn">
            {g.status_orient ?? "aguardando_fabricante"}
          </span>
        ) : g.aprovado === null ? (
          <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold text-text-soft">
            Aguardando decisão
          </span>
        ) : g.aprovado ? (
          <span className="rounded-full bg-ok-bg px-2.5 py-1 text-xs font-bold text-ok">Aprovada</span>
        ) : (
          <span className="rounded-full bg-crit-bg px-2.5 py-1 text-xs font-bold text-crit">Reprovada</span>
        )}
        {erro && <p className="mt-1 text-xs font-medium text-crit">{erro}</p>}
      </td>
      <td className="px-5 py-2.5 text-right">
        {podeAprovar && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decidir(true)}
              className="rounded-full border border-ok px-3 py-1 text-xs font-semibold text-ok disabled:opacity-60"
            >
              {g.aprovado === null ? "Aprovar" : "Revisar → Aprovar"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decidir(false)}
              className="rounded-full border border-crit px-3 py-1 text-xs font-semibold text-crit disabled:opacity-60"
            >
              {g.aprovado === null ? "Reprovar" : "Revisar → Reprovar"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
