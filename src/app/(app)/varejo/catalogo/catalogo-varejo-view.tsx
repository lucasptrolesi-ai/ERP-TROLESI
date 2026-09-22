"use client";

import { useState, useTransition } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { cadastrarProdutoCatalogo, registrarEntradaEstoque } from "@/lib/actions/varejo";
import { Modal } from "@/components/modal";
import type { VariacaoNova } from "@/lib/varejo/tipos";

type LinhaCatalogo = {
  variacao_id: string;
  produto_nome: string;
  categoria: string | null;
  sku: string;
  preco_venda: number;
  preco_minimo: number | null;
  ativo: boolean;
};

export function CatalogoVarejoView({
  linhas,
  depositos,
}: {
  linhas: LinhaCatalogo[];
  depositos: { id: string; nome: string }[];
}) {
  const [novoAberto, setNovoAberto] = useState(false);
  const [entradaVariacao, setEntradaVariacao] = useState<LinhaCatalogo | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Catálogo do varejo</h1>
        <button
          type="button"
          onClick={() => setNovoAberto(true)}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-sm font-semibold text-gold-ink"
        >
          Novo produto
        </button>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-text-soft">
              <th className="px-4 py-2.5">Produto</th>
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Preço</th>
              <th className="px-4 py-2.5">Mínimo</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.variacao_id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  {l.produto_nome}
                  {l.categoria && <span className="text-text-soft"> · {l.categoria}</span>}
                </td>
                <td className="px-4 py-2.5">{l.sku}</td>
                <td className="px-4 py-2.5">{formatarMoeda(l.preco_venda)}</td>
                <td className="px-4 py-2.5">{l.preco_minimo != null ? formatarMoeda(l.preco_minimo) : "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" onClick={() => setEntradaVariacao(l)} className="text-xs font-semibold text-rose-deep underline decoration-dotted">
                    Entrada de estoque
                  </button>
                </td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-soft">
                  Nenhum produto cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NovoProdutoModal aberto={novoAberto} onFechar={() => setNovoAberto(false)} />
      {entradaVariacao && (
        <EntradaEstoqueModal variacao={entradaVariacao} depositos={depositos} onFechar={() => setEntradaVariacao(null)} />
      )}
    </div>
  );
}

function NovoProdutoModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [variacoes, setVariacoes] = useState<VariacaoNova[]>([{ sku: "", atributos: "", preco_venda: 0, preco_minimo: null }]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function atualizarVariacao(indice: number, campo: keyof VariacaoNova, valor: string) {
    setVariacoes((atual) =>
      atual.map((v, i) => {
        if (i !== indice) return v;
        if (campo === "preco_venda") return { ...v, preco_venda: Number(valor.replace(",", ".")) || 0 };
        if (campo === "preco_minimo") return { ...v, preco_minimo: valor.trim() === "" ? null : Number(valor.replace(",", ".")) || 0 };
        return { ...v, [campo]: valor };
      }),
    );
  }

  function salvar() {
    setErro(null);
    if (!nome.trim()) {
      setErro("Informe o nome do produto.");
      return;
    }
    if (variacoes.some((v) => !v.sku.trim() || v.preco_venda <= 0)) {
      setErro("Cada variação precisa de SKU e preço de venda maior que zero.");
      return;
    }
    iniciar(async () => {
      const resposta = await cadastrarProdutoCatalogo(nome, categoria, variacoes);
      if (resposta.erro) {
        setErro(resposta.erro);
        return;
      }
      onFechar();
      setNome("");
      setCategoria("");
      setVariacoes([{ sku: "", atributos: "", preco_venda: 0, preco_minimo: null }]);
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Novo produto">
      <div className="flex flex-col gap-3">
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do produto" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        <input type="text" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Categoria (opcional)" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />

        <p className="text-xs font-semibold text-text-soft">Variações — joia = uma variação; roupa/calçado = uma por tamanho/cor</p>
        {variacoes.map((v, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3">
            <input type="text" value={v.sku} onChange={(e) => atualizarVariacao(i, "sku", e.target.value)} placeholder="SKU" className="rounded border border-line px-2 py-1.5 text-sm" />
            <input type="text" value={v.atributos} onChange={(e) => atualizarVariacao(i, "atributos", e.target.value)} placeholder="tamanho 16, cor ouro" className="rounded border border-line px-2 py-1.5 text-sm" />
            <input
              type="text"
              value={v.preco_venda || ""}
              onChange={(e) => atualizarVariacao(i, "preco_venda", e.target.value)}
              placeholder="Preço de venda"
              className="rounded border border-line px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              value={v.preco_minimo ?? ""}
              onChange={(e) => atualizarVariacao(i, "preco_minimo", e.target.value)}
              placeholder="Preço mínimo (opcional)"
              className="rounded border border-line px-2 py-1.5 text-sm"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setVariacoes((a) => [...a, { sku: "", atributos: "", preco_venda: 0, preco_minimo: null }])}
          className="self-start text-xs font-semibold text-rose-deep underline decoration-dotted"
        >
          + Adicionar variação
        </button>

        {erro && <p className="text-sm text-red-700">{erro}</p>}
        <button
          type="button"
          onClick={salvar}
          disabled={pendente}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Salvando…" : "Salvar produto"}
        </button>
      </div>
    </Modal>
  );
}

function EntradaEstoqueModal({
  variacao,
  depositos,
  onFechar,
}: {
  variacao: LinhaCatalogo;
  depositos: { id: string; nome: string }[];
  onFechar: () => void;
}) {
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? "");
  const [quantidade, setQuantidade] = useState("1");
  const [custoTexto, setCustoTexto] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar() {
    setErro(null);
    const qtd = Number(quantidade);
    if (!depositoId) {
      setErro("Selecione o depósito.");
      return;
    }
    if (!Number.isInteger(qtd) || qtd <= 0) {
      setErro("Quantidade inválida.");
      return;
    }
    iniciar(async () => {
      const resposta = await registrarEntradaEstoque(depositoId, variacao.variacao_id, qtd, custoTexto, observacao);
      if (resposta.erro) {
        setErro(resposta.erro);
        return;
      }
      onFechar();
    });
  }

  return (
    <Modal aberto onFechar={onFechar} titulo={`Entrada de estoque — ${variacao.produto_nome}`}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Depósito
          <select value={depositoId} onChange={(e) => setDepositoId(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2">
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Quantidade
          <input type="text" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Custo unitário
          <input type="text" value={custoTexto} onChange={(e) => setCustoTexto(e.target.value)} placeholder="R$ 0,00" className="rounded-lg border border-line bg-surface px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Observação (opcional)
          <input type="text" value={observacao} onChange={(e) => setObservacao(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2" />
        </label>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
        <button
          type="button"
          onClick={salvar}
          disabled={pendente}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Salvando…" : "Registrar entrada"}
        </button>
      </div>
    </Modal>
  );
}
