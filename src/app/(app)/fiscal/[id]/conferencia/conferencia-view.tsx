"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso } from "@/lib/datas";
import { atualizarDadosFiscais, marcarComoValidada } from "@/lib/actions/fiscal";
import { EMPRESA } from "@/lib/empresa";
import type { NotaFiscal } from "@/lib/types";

export type ItemNota = {
  quantidade: number;
  preco_unitario: number;
  produtos: { nome: string; ncm: string | null; csosn: string } | null;
};

export function ConferenciaView({ nota, itens }: { nota: NotaFiscal; itens: ItemNota[] }) {
  const router = useRouter();
  const editavel = nota.status === "gerada";
  const [cfop, setCfop] = useState(nota.cfop);
  const [naturezaOperacao, setNaturezaOperacao] = useState(nota.natureza_operacao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();
  const [validando, iniciarValidacao] = useTransition();

  function salvar() {
    setErro(null);
    iniciarSalvamento(async () => {
      const resultado = await atualizarDadosFiscais(nota.id, { cfop, naturezaOperacao });
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  function validar() {
    if (!confirm("Marcar essa nota como validada? Confirma que você já conferiu os dados contra o pedido real.")) {
      return;
    }
    setErro(null);
    iniciarValidacao(async () => {
      const resultado = await marcarComoValidada(nota.id);
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] border-2 border-warn bg-warn-bg p-4 text-center">
        <p className="text-sm font-bold text-warn">⚠ RASCUNHO DE CONFERÊNCIA — NÃO É DOCUMENTO FISCAL VÁLIDO</p>
        <p className="mt-0.5 text-xs text-warn">Nada foi transmitido à SEFAZ. A emissão oficial continua pelo GMax por enquanto.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold text-ink">
              Pedido #{nota.pedidos?.numero ?? "—"} — {nota.clientes?.razao_social || nota.clientes?.nome}
            </h2>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] font-semibold uppercase text-text-soft">CFOP</label>
                <input
                  value={cfop}
                  onChange={(e) => setCfop(e.target.value)}
                  disabled={!editavel}
                  className="rounded-lg border border-line bg-cream px-3 py-2 text-sm disabled:opacity-60"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] font-semibold uppercase text-text-soft">Natureza da operação</label>
                <input
                  value={naturezaOperacao}
                  onChange={(e) => setNaturezaOperacao(e.target.value)}
                  disabled={!editavel}
                  className="rounded-lg border border-line bg-cream px-3 py-2 text-sm disabled:opacity-60"
                />
              </div>
            </div>

            <div className="rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase text-text-soft">
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">NCM</th>
                    <th className="px-3 py-2">CSOSN</th>
                    <th className="px-3 py-2">Qtd.</th>
                    <th className="px-3 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-3 py-2">{item.produtos?.nome ?? "Produto"}</td>
                      <td className="px-3 py-2">
                        {item.produtos?.ncm ?? (
                          <span className="font-semibold text-warn" title="Produto sem NCM cadastrado — CSOSN pode não ter sido conferido">
                            ⚠ SEM NCM
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{item.produtos?.csosn ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{item.quantidade}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatarMoeda(item.quantidade * item.preco_unitario)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-semibold text-rose-deep">
              <span>Total</span>
              <span className="tabular-nums">{formatarMoeda(nota.valor_total)}</span>
            </div>

            {erro && (
              <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
                {erro}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <a
                href={`/fiscal/${nota.id}/danfe`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
              >
                📄 Ver DANFE
              </a>
              {editavel && (
                <>
                  <button
                    onClick={salvar}
                    disabled={salvando}
                    className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink disabled:opacity-60"
                  >
                    {salvando ? "Salvando…" : "Salvar alterações"}
                  </button>
                  <button
                    onClick={validar}
                    disabled={validando}
                    className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-xs font-semibold text-[#3b2914] disabled:opacity-60"
                  >
                    {validando ? "Validando…" : "✓ Marcar como validada"}
                  </button>
                </>
              )}
              {!editavel && (
                <span className="rounded-full bg-ok-bg px-4 py-2 text-xs font-semibold text-ok">
                  {nota.status === "validada" ? "Validada" : nota.status}
                  {nota.validada_em ? ` em ${formatarDataIso(nota.validada_em)}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[14px] border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold text-ink">Prévia do XML</h2>
          </div>
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-all p-4 text-xs text-ink">
            {nota.xml ?? "Sem XML gerado."}
          </pre>
        </div>
      </div>

      <p className="text-center text-xs text-text-soft">
        Emitente de referência: {EMPRESA.nome} · {EMPRESA.cpfCnpj}
      </p>
    </div>
  );
}
