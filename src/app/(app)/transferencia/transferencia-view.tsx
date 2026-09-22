"use client";

import { useMemo, useState, useTransition } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { filtra } from "@/lib/filtra";
import { buscarVariacoesDoVarejo, transferirEstoque, type VariacaoDeOutraOperacao } from "@/lib/actions/varejo";

type ProdutoAtacado = { id: string; nome: string; codigo_peca: number | null; quantidade_estoque: number };
type Linha = { produto: ProdutoAtacado; variacaoDestino: VariacaoDeOutraOperacao | null; quantidade: number };

export function TransferenciaView({ produtosAtacado }: { produtosAtacado: ProdutoAtacado[] }) {
  const [buscaOrigem, setBuscaOrigem] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [buscaDestinoTexto, setBuscaDestinoTexto] = useState("");
  const [resultadosDestino, setResultadosDestino] = useState<VariacaoDeOutraOperacao[]>([]);
  const [buscandoDestino, iniciarBuscaDestino] = useTransition();
  const [vencimento, setVencimento] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();

  const resultadosOrigem = useMemo(() => {
    if (buscaOrigem.trim().length < 1) return [];
    return filtra(produtosAtacado, buscaOrigem, (p) => p.nome).slice(0, 8);
  }, [produtosAtacado, buscaOrigem]);

  function adicionar(produto: ProdutoAtacado) {
    if (linhas.some((l) => l.produto.id === produto.id)) return;
    setLinhas((a) => [...a, { produto, variacaoDestino: null, quantidade: 1 }]);
    setBuscaOrigem("");
  }

  function buscarDestino(termo: string) {
    setBuscaDestinoTexto(termo);
    iniciarBuscaDestino(async () => {
      setResultadosDestino(termo.trim().length >= 1 ? await buscarVariacoesDoVarejo(termo) : []);
    });
  }

  function definirDestino(produtoId: string, variacao: VariacaoDeOutraOperacao) {
    setLinhas((a) => a.map((l) => (l.produto.id === produtoId ? { ...l, variacaoDestino: variacao } : l)));
    setResultadosDestino([]);
    setBuscaDestinoTexto("");
  }

  function mudarQuantidade(produtoId: string, quantidade: number) {
    setLinhas((a) => a.map((l) => (l.produto.id === produtoId ? { ...l, quantidade } : l)));
  }

  function remover(produtoId: string) {
    setLinhas((a) => a.filter((l) => l.produto.id !== produtoId));
  }

  function confirmar() {
    setErro(null);
    if (linhas.length === 0) {
      setErro("Adicione ao menos um item.");
      return;
    }
    if (linhas.some((l) => !l.variacaoDestino)) {
      setErro("Escolha a variação de destino no varejo para cada item.");
      return;
    }
    if (linhas.some((l) => l.quantidade <= 0 || l.quantidade > l.produto.quantidade_estoque)) {
      setErro("Há quantidade inválida ou acima do estoque disponível do atacado.");
      return;
    }
    iniciarEnvio(async () => {
      const resposta = await transferirEstoque(
        linhas.map((l) => ({
          produto_origem_id: l.produto.id,
          variacao_destino_id: l.variacaoDestino!.variacao_id,
          quantidade: l.quantidade,
        })),
        vencimento,
      );
      if (resposta.erro) {
        setErro(resposta.erro);
        return;
      }
      setSucesso(
        `Transferência #${resposta.numero} registrada — total ${formatarMoeda(resposta.total ?? 0)}. O custo foi calculado pelo sistema.`,
      );
      setLinhas([]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Transferência para o varejo</h1>
        <p className="text-sm text-text-soft">
          O custo de cada peça é calculado pelo sistema (código × multiplicador vigente). Gera conta a receber no
          atacado e conta a pagar no varejo, marcadas como intercompany.
        </p>
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <input
          type="text"
          value={buscaOrigem}
          onChange={(e) => setBuscaOrigem(e.target.value)}
          placeholder="Buscar peça do atacado por nome"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        {resultadosOrigem.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-line">
            {resultadosOrigem.map((p) => (
              <button key={p.id} type="button" onClick={() => adicionar(p)} className="border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-black/5">
                {p.nome} — {p.quantidade_estoque} un
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {linhas.map((l) => (
            <div key={l.produto.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{l.produto.nome}</span>
                <button type="button" onClick={() => remover(l.produto.id)} className="text-xs text-text-soft underline decoration-dotted">
                  Remover
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-text-soft">Qtd</span>
                <input
                  type="number"
                  min={1}
                  max={l.produto.quantidade_estoque}
                  value={l.quantidade}
                  onChange={(e) => mudarQuantidade(l.produto.id, Number(e.target.value))}
                  className="w-16 rounded border border-line px-2 py-1"
                />
                <span className="text-text-soft">Destino no varejo</span>
                {l.variacaoDestino ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    {l.variacaoDestino.nome} · {l.variacaoDestino.sku}
                  </span>
                ) : (
                  <div className="relative flex-1 min-w-[12rem]">
                    <input
                      type="text"
                      value={l.variacaoDestino ? "" : buscaDestinoTexto}
                      onChange={(e) => buscarDestino(e.target.value)}
                      placeholder="Buscar variação do varejo"
                      className="w-full rounded border border-line px-2 py-1"
                    />
                    {resultadosDestino.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-sm">
                        {resultadosDestino.map((v) => (
                          <button
                            key={v.variacao_id}
                            type="button"
                            onClick={() => definirDestino(l.produto.id, v)}
                            className="block w-full border-b border-line px-3 py-2 text-left text-xs last:border-0 hover:bg-black/5"
                          >
                            {v.nome} · {v.sku}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {linhas.length === 0 && <p className="text-sm text-text-soft">Busque uma peça do atacado para começar.</p>}
        </div>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          Vencimento da conta intercompany (opcional — padrão 30 dias)
          <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="w-52 rounded-lg border border-line bg-surface px-3 py-2" />
        </label>

        {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}
        {sucesso && <p className="mt-3 text-sm text-emerald-700">{sucesso}</p>}

        <button
          type="button"
          onClick={confirmar}
          disabled={enviando || linhas.length === 0}
          className="mt-4 rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2.5 font-semibold text-gold-ink disabled:opacity-60"
        >
          {enviando ? "Transferindo…" : "Confirmar transferência"}
        </button>
        {buscandoDestino && <p className="mt-1 text-xs text-text-soft">Buscando…</p>}
      </div>
    </div>
  );
}
