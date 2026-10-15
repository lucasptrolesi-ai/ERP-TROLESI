"use client";

import { useMemo, useRef, useState } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { buscarStatusLote, imprimirEtiquetas, type ModeloResumo } from "@/lib/actions/etiquetas";

export type LinhaLote = {
  variacaoId: string;
  codigo: string;
  nome: string;
  atributos: string;
  preco: number;
  estoque: number;
  quantidadeSugerida: number;
};

const INTERVALO_POLLING_MS = 1500;
const TENTATIVAS_POLLING = 60; // ~90s — lote pode ter dezenas/centenas de etiquetas
const SEGUNDOS_POR_ETIQUETA = 1.6; // velocidade 2 da Elgin, mesma estimativa do plano aprovado

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EstadoLinha = { on: boolean; qtd: number };

/** "Imprimir em lote" básico (Fase A): busca, seleção, quantidade (+/-), modelo, imprimir. Sem os
 * filtros "sem etiqueta impressa"/"preço alterado"/"importar planilha" do plano completo — ficam
 * pra quando o histórico (etiqueta_impressoes) tiver dado real acumulado pra valer a pena (Fase B). */
export function LoteEtiquetasView({ linhas, modelos, modeloIdInicial }: { linhas: LinhaLote[]; modelos: ModeloResumo[]; modeloIdInicial?: string }) {
  const [busca, setBusca] = useState("");
  const [estados, setEstados] = useState<Map<string, EstadoLinha>>(
    () => new Map(linhas.map((l) => [l.variacaoId, { on: l.quantidadeSugerida > 0, qtd: l.quantidadeSugerida || 1 }])),
  );
  const modeloPadraoId = modelos.find((m) => m.padrao_varejo)?.id ?? modelos[0]?.id;
  const [modeloId, setModeloId] = useState(modeloIdInicial && modelos.some((m) => m.id === modeloIdInicial) ? modeloIdInicial : modeloPadraoId);
  const [status, setStatus] = useState<"parado" | "enviando" | "imprimindo" | "concluido" | "erro">("parado");
  const [progresso, setProgresso] = useState<{ impressas: number; comErro: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const enviandoRef = useRef(false);

  const linhasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter((l) => l.nome.toLowerCase().includes(termo) || l.codigo.toLowerCase().includes(termo));
  }, [busca, linhas]);

  function alterarEstado(variacaoId: string, mudanca: Partial<EstadoLinha>) {
    setEstados((atual) => {
      const copia = new Map(atual);
      const atualEstado = copia.get(variacaoId) ?? { on: false, qtd: 1 };
      copia.set(variacaoId, { ...atualEstado, ...mudanca });
      return copia;
    });
  }

  const selecionadas = linhas.filter((l) => estados.get(l.variacaoId)?.on);
  const totalEtiquetas = selecionadas.reduce((s, l) => s + (estados.get(l.variacaoId)?.qtd ?? 0), 0);
  const modelo = modelos.find((m) => m.id === modeloId);
  const tempoEstimadoSegundos = Math.round(totalEtiquetas * SEGUNDOS_POR_ETIQUETA);
  const tempoEstimado = tempoEstimadoSegundos < 60 ? `cerca de ${tempoEstimadoSegundos}s` : `cerca de ${Math.ceil(tempoEstimadoSegundos / 60)}min`;

  async function imprimir() {
    if (enviandoRef.current || !modeloId || selecionadas.length === 0) return;
    enviandoRef.current = true;
    setErro(null);
    setProgresso(null);
    setStatus("enviando");

    const itens = selecionadas.map((l) => ({ variacaoId: l.variacaoId, quantidade: estados.get(l.variacaoId)?.qtd ?? 1 }));
    const resultado = await imprimirEtiquetas(itens, modeloId);
    if (resultado.erro || !resultado.ids?.length) {
      setErro(resultado.erro ?? "Não foi possível criar as solicitações de impressão.");
      setStatus("erro");
      enviandoRef.current = false;
      return;
    }

    setStatus("imprimindo");
    const ids = resultado.ids;
    for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
      await aguardar(INTERVALO_POLLING_MS);
      const resumo = await buscarStatusLote(ids);
      setProgresso({ impressas: resumo.impressas, comErro: resumo.comErro, total: resumo.total });
      if (resumo.pendentes === 0) {
        setStatus(resumo.comErro > 0 ? "erro" : "concluido");
        if (resumo.comErro > 0) setErro(`${resumo.comErro} etiqueta(s) deram erro na impressão — confira o print-agent.`);
        enviandoRef.current = false;
        return;
      }
    }
    setErro("A impressora não confirmou todas em tempo — confira se o print-agent está rodando na Mac da loja.");
    setStatus("erro");
    enviandoRef.current = false;
  }

  const pendente = status === "enviando" || status === "imprimindo";

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código"
            aria-label="Buscar peça"
            className="h-11 flex-1 rounded-lg border border-line bg-cream px-3 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-text-soft">
                <th className="px-4 py-2.5" />
                <th className="px-2 py-2.5">Código</th>
                <th className="px-2 py-2.5">Peça</th>
                <th className="px-2 py-2.5">Atributos</th>
                <th className="px-2 py-2.5 text-right">Preço</th>
                <th className="px-2 py-2.5 text-right">Estoque</th>
                <th className="px-4 py-2.5 text-center">Etiquetas</th>
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.map((l) => {
                const estado = estados.get(l.variacaoId) ?? { on: false, qtd: 1 };
                return (
                  <tr key={l.variacaoId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={estado.on}
                        onChange={(e) => alterarEstado(l.variacaoId, { on: e.target.checked })}
                        aria-label={`Selecionar ${l.nome}`}
                        className="h-[18px] w-[18px] accent-rose-deep"
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-text-soft">#{l.codigo}</td>
                    <td className="px-2 py-2 font-medium">{l.nome}</td>
                    <td className="px-2 py-2 text-text-soft">{l.atributos || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarMoeda(l.preco)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-text-soft">{l.estoque}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          aria-label={`Menos etiquetas de ${l.nome}`}
                          onClick={() => alterarEstado(l.variacaoId, { qtd: Math.max(1, estado.qtd - 1) })}
                          className="h-9 w-9 rounded border border-line bg-cream text-base"
                        >
                          −
                        </button>
                        <span className="w-9 text-center font-semibold tabular-nums">{estado.qtd}</span>
                        <button
                          type="button"
                          aria-label={`Mais etiquetas de ${l.nome}`}
                          onClick={() => alterarEstado(l.variacaoId, { qtd: estado.qtd + 1 })}
                          className="h-9 w-9 rounded border border-line bg-cream text-base"
                        >
                          +
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {linhasFiltradas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-soft">
                    Nenhuma peça encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line p-3 text-xs text-text-soft">A quantidade começa igual ao estoque que entrou hoje (senão, o estoque atual). Ajuste se quiser.</p>
      </section>

      <aside className="flex w-full max-w-[380px] flex-1 flex-col gap-3">
        <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Modelo</span>
          <div className="flex flex-col gap-2">
            {modelos.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModeloId(m.id)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${
                  m.id === modeloId ? "border-rose-deep bg-rose-soft" : "border-line bg-surface"
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-semibold">{m.nome}</span>
                  <span className="text-xs text-text-soft">
                    {m.largura_mm} × {m.altura_mm} mm
                  </span>
                </span>
              </button>
            ))}
            {modelos.length === 0 && <p className="text-sm text-text-soft">Nenhum modelo cadastrado ainda.</p>}
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-4 shadow-sm">
          <div className="flex justify-between text-sm">
            <span>Peças selecionadas</span>
            <strong className="tabular-nums">{selecionadas.length}</strong>
          </div>
          <div className="flex justify-between text-sm">
            <span>Total de etiquetas</span>
            <strong className="tabular-nums">{totalEtiquetas}</strong>
          </div>
          <div className="flex justify-between text-xs text-text-soft">
            <span>Tempo estimado</span>
            <span>{tempoEstimado}</span>
          </div>

          {status === "imprimindo" && progresso && (
            <p className="text-sm text-text-soft">
              Imprimindo… {progresso.impressas + progresso.comErro} de {progresso.total}
            </p>
          )}
          {status === "concluido" && <p className="text-sm font-medium text-ok">Impresso!</p>}
          {erro && (
            <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
              {erro}
            </p>
          )}

          <button
            type="button"
            onClick={imprimir}
            disabled={pendente || !modelo || selecionadas.length === 0 || totalEtiquetas === 0}
            className="mt-1 rounded-lg bg-gradient-to-br from-gold-start to-gold-end py-3 text-base font-semibold text-gold-ink disabled:opacity-60"
          >
            {pendente ? "Imprimindo…" : `Imprimir ${totalEtiquetas} etiqueta${totalEtiquetas === 1 ? "" : "s"}`}
          </button>
        </div>
      </aside>
    </div>
  );
}
