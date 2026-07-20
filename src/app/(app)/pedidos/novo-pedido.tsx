"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClienteForm } from "@/components/cliente-form";
import { criarPedido } from "@/lib/actions/pedidos";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { parseMoeda } from "@/lib/parse-moeda";
import { hojeIso } from "@/lib/datas";
import { calcularPrecoUnitario } from "@/lib/precificacao";
import type { Cliente, FormaPagamento, ItemCarrinho, Parcela, Produto } from "@/lib/types";

function somaMeses(dataIso: string, meses: number): string {
  const data = new Date(`${dataIso}T00:00:00`);
  data.setMonth(data.getMonth() + meses);
  return data.toISOString().slice(0, 10);
}

export function NovoPedido({
  clientes,
  produtos,
  onVoltarParaLista,
}: {
  clientes: Cliente[];
  produtos: Produto[];
  onVoltarParaLista: () => void;
}) {
  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [novoClienteAberto, setNovoClienteAberto] = useState(false);
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");

  const [percentualDesconto, setPercentualDesconto] = useState<string>("");
  const [valorDesconto, setValorDesconto] = useState<string>("0");
  const [percentualAcrescimo, setPercentualAcrescimo] = useState<string>("");
  const [valorAcrescimo, setValorAcrescimo] = useState<string>("0");

  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("dinheiro");
  const [numeroParcelas, setNumeroParcelas] = useState(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hojeIso());
  const [valorComJuros, setValorComJuros] = useState<string>("");

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();
  const [pedidoCriado, setPedidoCriado] = useState<{ id: string; promissoria: boolean } | null>(null);
  const router = useRouter();

  const clientesFiltrados = useMemo(() => {
    const termo = buscaCliente.trim().toLowerCase();
    if (!termo) return [];
    return clientes
      .filter(
        (c) =>
          c.nome.toLowerCase().includes(termo) ||
          (c.telefone ?? "").includes(termo) ||
          (c.cpf_cnpj ?? "").includes(termo),
      )
      .slice(0, 8);
  }, [clientes, buscaCliente]);

  const produtosFiltrados = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return produtos
      .filter(
        (p) =>
          p.nome.toLowerCase().includes(termo) ||
          p.categoria.toLowerCase().includes(termo) ||
          (p.codigo_interno ?? "").toLowerCase().includes(termo),
      )
      .slice(0, 8);
  }, [produtos, buscaProduto]);

  const subtotal = carrinho.reduce((soma, i) => soma + i.quantidade * i.preco_unitario, 0);
  const numDesconto = parseMoeda(valorDesconto);
  const numAcrescimo = parseMoeda(valorAcrescimo);
  const total = Math.max(0, subtotal - numDesconto + numAcrescimo);

  const parcelasSemJuros = formaPagamento === "cartao_credito" && numeroParcelas <= 3;
  const parcelasComJuros = formaPagamento === "cartao_credito" && numeroParcelas >= 4;
  const ehPromissoria = formaPagamento === "promissoria";
  const temParcelamento = formaPagamento === "cartao_credito" || ehPromissoria;

  // No cartão 4-12x, o valor total já vem com o juros da maquininha — a
  // pessoa digita o total cobrado, o simulador só divide igualmente pra
  // mostrar quanto fica cada parcela (não editável parcela por parcela).
  const totalParaDividir = parcelasComJuros ? parseMoeda(valorComJuros) : total;

  // Diferença entre o total cobrado na maquininha e o total calculado pelo
  // carrinho (subtotal - desconto + acréscimo) — precisa ir junto como
  // acréscimo pro servidor recalcular o mesmo total das parcelas, senão a
  // checagem de reconciliação (soma das parcelas == total) rejeita a venda.
  const juroCartao = parcelasComJuros ? totalParaDividir - total : 0;

  function parcelasCalculadas(): Parcela[] {
    if (!temParcelamento || numeroParcelas <= 0) return [];
    const valorParcela = Math.round((totalParaDividir / numeroParcelas) * 100) / 100;
    const parcelas = Array.from({ length: numeroParcelas }, (_, i) => ({
      valor: valorParcela,
      vencimento: somaMeses(primeiroVencimento, i),
    }));
    // A última parcela absorve o resto do arredondamento, pra soma bater
    // exatamente com totalParaDividir (ex: 100 / 3x não divide redondo).
    const somaSemUltima = valorParcela * (numeroParcelas - 1);
    parcelas[parcelas.length - 1].valor = Math.round((totalParaDividir - somaSemUltima) * 100) / 100;
    return parcelas;
  }

  function adicionarProduto(produto: Produto) {
    setBuscaProduto("");
    if (produto.quantidade_estoque <= 0) return;
    setCarrinho((atual) => {
      const existente = atual.find((i) => i.produto_id === produto.id);
      if (existente) {
        if (existente.quantidade >= produto.quantidade_estoque) return atual;
        return atual.map((i) =>
          i.produto_id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i,
        );
      }
      return [
        ...atual,
        {
          produto_id: produto.id,
          nome: produto.nome,
          quantidade: 1,
          codigo_peca: produto.codigo_peca,
          multiplicador: produto.multiplicador,
          preco_unitario: produto.preco,
          estoqueDisponivel: produto.quantidade_estoque,
        },
      ];
    });
  }

  function alterarQuantidade(produtoId: string, quantidade: number) {
    setCarrinho((atual) =>
      atual.map((i) =>
        i.produto_id === produtoId
          ? { ...i, quantidade: Math.max(1, Math.min(quantidade, i.estoqueDisponivel)) }
          : i,
      ),
    );
  }

  function alterarCodigoPeca(produtoId: string, codigoPeca: number) {
    setCarrinho((atual) =>
      atual.map((i) =>
        i.produto_id === produtoId
          ? { ...i, codigo_peca: codigoPeca, preco_unitario: calcularPrecoUnitario(codigoPeca, i.multiplicador) }
          : i,
      ),
    );
  }

  function removerItem(produtoId: string) {
    setCarrinho((atual) => atual.filter((i) => i.produto_id !== produtoId));
  }

  function limparFormulario() {
    setClienteSelecionado(null);
    setCarrinho([]);
    setBuscaCliente("");
    setPercentualDesconto("");
    setValorDesconto("0");
    setPercentualAcrescimo("");
    setValorAcrescimo("0");
    setFormaPagamento("dinheiro");
    setNumeroParcelas(1);
    setPrimeiroVencimento(hojeIso());
    setValorComJuros("");
  }

  function salvar(status: "orcamento" | "faturado") {
    if (!clienteSelecionado) {
      setErro("Selecione um cliente.");
      return;
    }
    if (carrinho.length === 0) {
      setErro("Adicione pelo menos um produto.");
      return;
    }
    const parcelas = parcelasCalculadas();
    if (temParcelamento) {
      const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
      if (somaParcelas <= 0) {
        setErro("Informe o valor das parcelas.");
        return;
      }
    }
    if (total <= 0 && !confirm("O valor a pagar deste pedido é R$0,00. Confirma finalizar mesmo assim?")) {
      return;
    }
    setErro(null);
    iniciarSalvamento(async () => {
      const resultado = await criarPedido(
        clienteSelecionado.id,
        carrinho,
        formaPagamento,
        status,
        {
          valorDesconto: numDesconto,
          percentualDesconto: percentualDesconto ? parseMoeda(percentualDesconto) : null,
          // Quando o cartão tem juros da maquininha, dobra a diferença no
          // acréscimo enviado pro servidor — ver comentário de juroCartao.
          valorAcrescimo: numAcrescimo + juroCartao,
          // Percentual de acréscimo perde sentido junto com juros de
          // cartão (o valor final não é mais um % simples do subtotal).
          percentualAcrescimo: juroCartao !== 0 ? null : percentualAcrescimo ? parseMoeda(percentualAcrescimo) : null,
        },
        parcelas,
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
      if (resultado.pedidoId) {
        setPedidoCriado({ id: resultado.pedidoId, promissoria: ehPromissoria });
      }
      limparFormulario();
    });
  }

  if (pedidoCriado) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok">
          ✓
        </div>
        <h2 className="font-display text-xl font-semibold text-ink">Pedido criado com sucesso!</h2>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={`/pedidos/${pedidoCriado.id}/cupom`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink"
          >
            🧾 Imprimir cupom (80mm)
          </a>
          {pedidoCriado.promissoria && (
            <a
              href={`/pedidos/${pedidoCriado.id}/promissorias`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink"
            >
              📄 Imprimir notas promissórias
            </a>
          )}
        </div>
        <div className="mt-2 flex gap-3">
          <button
            onClick={() => setPedidoCriado(null)}
            className="rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white"
          >
            Novo pedido
          </button>
          <button
            onClick={onVoltarParaLista}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink"
          >
            Ver lista de pedidos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Cliente</label>
        {clienteSelecionado ? (
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-cream px-3 py-2">
            <span className="text-sm font-semibold text-ink">{clienteSelecionado.nome}</span>
            <button
              type="button"
              onClick={() => setClienteSelecionado(null)}
              className="text-xs font-semibold text-rose-deep hover:underline"
            >
              Trocar
            </button>
          </div>
        ) : (
          <div className="relative mt-1.5">
            <div className="flex gap-2">
              <input
                value={buscaCliente}
                onChange={(e) => setBuscaCliente(e.target.value)}
                placeholder="Buscar cliente por nome, telefone ou documento"
                className="w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
              <button
                type="button"
                onClick={() => setNovoClienteAberto(true)}
                className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-rose-deep"
              >
                + Novo
              </button>
            </div>
            {clientesFiltrados.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border-2 border-rose-soft bg-cream shadow-lg">
                {clientesFiltrados.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setClienteSelecionado(c);
                        setBuscaCliente("");
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-rose-soft/40"
                    >
                      {c.nome} <span className="text-text-soft">— {c.telefone ?? "sem telefone"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
          Adicionar produto
        </label>
        <div className="relative mt-1.5">
          <input
            value={buscaProduto}
            onChange={(e) => setBuscaProduto(e.target.value)}
            placeholder="Buscar por nome, categoria ou código interno"
            className="w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
          />
          {produtosFiltrados.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border-2 border-rose-soft bg-cream shadow-lg">
              {produtosFiltrados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => adicionarProduto(p)}
                    disabled={p.quantidade_estoque <= 0}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-rose-soft/40 disabled:opacity-40"
                  >
                    <span>{p.nome}</span>
                    <span className="text-text-soft">
                      {formatarMoeda(p.preco)} · {p.quantidade_estoque} em estoque
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Qtd.</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Preço unit.</th>
              <th className="px-3 py-2">Subtotal</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {carrinho.map((i) => (
              <tr key={i.produto_id} className="border-t border-line">
                <td className="px-3 py-2">{i.nome}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    max={i.estoqueDisponivel}
                    value={i.quantidade}
                    onChange={(e) => alterarQuantidade(i.produto_id, Number(e.target.value) || 1)}
                    className="w-16 rounded border border-line bg-cream px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={i.codigo_peca ?? 0}
                    onChange={(e) => alterarCodigoPeca(i.produto_id, Number(e.target.value) || 0)}
                    title={`Código × ${i.multiplicador} = preço unitário`}
                    className="w-20 rounded border border-line bg-cream px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2 tabular-nums">{formatarMoeda(i.preco_unitario)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatarMoeda(i.quantidade * i.preco_unitario)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removerItem(i.produto_id)}
                    className="text-text-soft hover:text-crit"
                    aria-label={`Remover ${i.nome}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {carrinho.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-text-soft">
                  Nenhum produto adicionado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-line bg-cream p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-text-soft">
          Desconto / acréscimo
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Desconto (%)</label>
            <input
              value={percentualDesconto}
              onChange={(e) => {
                setPercentualDesconto(e.target.value);
                const p = Number(e.target.value.replace(",", "."));
                if (Number.isFinite(p)) setValorDesconto(((subtotal * p) / 100).toFixed(2));
              }}
              placeholder="0"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Desconto (R$)</label>
            <input
              value={valorDesconto}
              onChange={(e) => setValorDesconto(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Acréscimo (%)</label>
            <input
              value={percentualAcrescimo}
              onChange={(e) => {
                setPercentualAcrescimo(e.target.value);
                const p = Number(e.target.value.replace(",", "."));
                if (Number.isFinite(p)) setValorAcrescimo(((subtotal * p) / 100).toFixed(2));
              }}
              placeholder="0"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Acréscimo (R$)</label>
            <input
              value={valorAcrescimo}
              onChange={(e) => setValorAcrescimo(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-cream p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-text-soft">
          Forma de pagamento
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["dinheiro", "Dinheiro"],
              ["pix", "Pix"],
              ["cartao_credito", "Cartão de crédito"],
              ["promissoria", "Promissória"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => {
                setFormaPagamento(valor);
                setNumeroParcelas(1);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                formaPagamento === valor
                  ? "border-rose bg-rose-soft text-rose-deep"
                  : "border-line bg-surface text-text-soft"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {formaPagamento === "cartao_credito" && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[0.7rem] text-text-soft">Parcelas</label>
              <select
                value={numeroParcelas}
                onChange={(e) => setNumeroParcelas(Number(e.target.value))}
                className="w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}x {n <= 3 ? "sem juros" : ""}
                  </option>
                ))}
              </select>
            </div>

            {parcelasSemJuros && (
              <p className="text-sm text-text-soft">
                {numeroParcelas}x de{" "}
                <span className="font-semibold text-ink">{formatarMoeda(total / numeroParcelas)}</span>{" "}
                sem juros.
              </p>
            )}

            {parcelasComJuros && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] text-text-soft">
                    Valor total já com o juros da maquininha (R$)
                  </label>
                  <input
                    value={valorComJuros}
                    onChange={(e) => setValorComJuros(e.target.value)}
                    placeholder={total.toFixed(2)}
                    className="w-40 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  />
                </div>
                {totalParaDividir > 0 && (
                  <div>
                    <p className="text-xs text-text-soft">Simulação das parcelas:</p>
                    <ul className="text-sm text-text-soft">
                      {Array.from({ length: numeroParcelas }, (_, i) => (
                        <li key={i}>
                          Parcela {i + 1}/{numeroParcelas} —{" "}
                          <span className="font-semibold text-ink">
                            {formatarMoeda(totalParaDividir / numeroParcelas)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {ehPromissoria && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] text-text-soft">Nº de parcelas</label>
                <select
                  value={numeroParcelas}
                  onChange={(e) => setNumeroParcelas(Number(e.target.value))}
                  className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}x
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] text-text-soft">1º vencimento</label>
                <input
                  type="date"
                  value={primeiroVencimento}
                  onChange={(e) => setPrimeiroVencimento(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <ul className="text-sm text-text-soft">
              {Array.from({ length: numeroParcelas }, (_, i) => (
                <li key={i}>
                  Parcela {i + 1}/{numeroParcelas} — vence{" "}
                  {new Date(`${somaMeses(primeiroVencimento, i)}T00:00:00`).toLocaleDateString("pt-BR")}{" "}
                  — <span className="font-semibold text-ink">{formatarMoeda(total / numeroParcelas)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <div className="flex w-full flex-col gap-2 rounded-lg border border-line bg-cream p-4 sm:w-72">
          <div className="flex justify-between text-sm">
            <span className="text-text-soft">Subtotal</span>
            <span className="tabular-nums">{formatarMoeda(subtotal)}</span>
          </div>
          {numDesconto > 0 && (
            <div className="flex justify-between text-sm text-ok">
              <span>Desconto</span>
              <span className="tabular-nums">− {formatarMoeda(numDesconto)}</span>
            </div>
          )}
          {numAcrescimo > 0 && (
            <div className="flex justify-between text-sm text-warn">
              <span>Acréscimo</span>
              <span className="tabular-nums">+ {formatarMoeda(numAcrescimo)}</span>
            </div>
          )}
          {juroCartao > 0 && (
            <div className="flex justify-between text-sm text-warn">
              <span>Juros do cartão</span>
              <span className="tabular-nums">+ {formatarMoeda(juroCartao)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-semibold text-rose-deep">
            <span>Valor a pagar</span>
            <span className="tabular-nums">
              {formatarMoeda(parcelasComJuros ? totalParaDividir : total)}
            </span>
          </div>
        </div>
      </div>

      {erro && (
        <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={salvando}
          onClick={() => salvar("orcamento")}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Salvar como orçamento
        </button>
        <button
          type="button"
          disabled={salvando}
          onClick={() => salvar("faturado")}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-[#3b2914] disabled:opacity-60"
        >
          {salvando ? "Processando…" : "Finalizar e faturar pedido"}
        </button>
      </div>

      {novoClienteAberto && (
        <ClienteForm
          aberto
          onFechar={() => {
            setNovoClienteAberto(false);
            router.refresh();
          }}
          cliente={null}
        />
      )}
    </div>
  );
}
