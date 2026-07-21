"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClienteForm } from "@/components/cliente-form";
import { criarPedido, buscarEstatisticasCliente } from "@/lib/actions/pedidos";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { parseMoeda } from "@/lib/parse-moeda";
import { formatarDataIso, hojeIso } from "@/lib/datas";
import { calcularPrecoPorCotacao, calcularPrecoUnitario } from "@/lib/precificacao";
import { calcularDescontoAutomatico } from "@/lib/desconto";
import { maxParcelasSemJuros } from "@/lib/parcelamento";
import type {
  Cliente,
  CotacaoDiaria,
  EstatisticasCliente,
  FaixaParcelamentoDb,
  FormaPagamento,
  ItemCarrinho,
  Parcela,
  Produto,
} from "@/lib/types";

function somaMeses(dataIso: string, meses: number): string {
  const data = new Date(`${dataIso}T00:00:00`);
  data.setMonth(data.getMonth() + meses);
  return data.toISOString().slice(0, 10);
}

const FORMAS_COM_DESCONTO_AUTOMATICO: FormaPagamento[] = ["dinheiro", "pix", "debito"];

export function NovoPedido({
  clientes,
  produtos,
  faixasParcelamento,
  cotacoesHoje,
  onVoltarParaLista,
}: {
  clientes: Cliente[];
  produtos: Produto[];
  faixasParcelamento: FaixaParcelamentoDb[];
  cotacoesHoje: CotacaoDiaria[];
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
  const [pagamentosMistos, setPagamentosMistos] = useState<{ forma: FormaPagamento; valor: string }[]>([
    { forma: "dinheiro", valor: "" },
    { forma: "pix", valor: "" },
  ]);

  const [estatisticasCliente, setEstatisticasCliente] = useState<EstatisticasCliente | null>(null);
  const [justificativaExcecao, setJustificativaExcecao] = useState("");

  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();
  const [pedidoCriado, setPedidoCriado] = useState<{ id: string; promissoria: boolean } | null>(null);
  const router = useRouter();

  const produtosPorId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  // Cotação diária (seção 6, decisão registrada em pending_decisions pra
  // 'multiplicador_ouro_cobre'): produtos com usa_cotacao_diaria usam
  // peso × cotação do dia × multiplicador em vez de código × multiplicador.
  // Sem cotação informada hoje, cai pro preço já cadastrado do produto (com
  // aviso), em vez de travar a venda.
  const cotacaoPorMaterial = useMemo(
    () => new Map(cotacoesHoje.map((c) => [c.material.trim().toLowerCase(), c.valor])),
    [cotacoesHoje],
  );

  useEffect(() => {
    // Limpar quando não há cliente selecionado acontece nos próprios
    // handlers que trocam `clienteSelecionado` (não aqui) — setState
    // síncrono direto no corpo do efeito é o padrão que o lint proíbe.
    if (!clienteSelecionado) return;
    let cancelado = false;
    buscarEstatisticasCliente(clienteSelecionado.id).then((stats) => {
      if (!cancelado) setEstatisticasCliente(stats);
    });
    return () => {
      cancelado = true;
    };
  }, [clienteSelecionado]);

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

  const itensSemCotacaoHoje = carrinho.filter((i) => {
    const produto = produtosPorId.get(i.produto_id);
    if (!produto?.usa_cotacao_diaria) return false;
    return cotacaoPorMaterial.get((produto.material ?? "").trim().toLowerCase()) == null;
  });

  // Desconto automático por forma de pagamento (dinheiro 10%/Pix 7%/débito
  // 7%) aplicado só sobre a base elegível — fornitura nunca entra. Pra
  // essas 3 formas, o desconto manual fica desligado (o cálculo é sempre o
  // automático); cartão de crédito/promissória continuam com desconto
  // manual, já que não têm regra automática.
  const temDescontoAutomatico = FORMAS_COM_DESCONTO_AUTOMATICO.includes(formaPagamento);
  const descontoAutomatico = calcularDescontoAutomatico(
    carrinho.map((i) => ({
      valor: i.quantidade * i.preco_unitario,
      elegivel: !produtosPorId.get(i.produto_id)?.eh_fornitura,
    })),
    formaPagamento,
  );
  const numDesconto = temDescontoAutomatico ? descontoAutomatico.valorDesconto : parseMoeda(valorDesconto);
  const numAcrescimo = parseMoeda(valorAcrescimo);
  const total = Math.max(0, subtotal - numDesconto + numAcrescimo);

  const ehPromissoria = formaPagamento === "promissoria";
  const temParcelamento = formaPagamento === "cartao_credito" || ehPromissoria;
  const ehMisto = formaPagamento === "misto";
  const somaPagamentosMistos = pagamentosMistos.reduce((s, p) => s + (parseMoeda(p.valor) || 0), 0);

  // Limiares de parcelamento sem juros por valor da venda (seção 9): a
  // partir de R$200 até 2x, a partir de R$300 até 3x — nunca a interface
  // oferece uma parcela "sem juros" que a venda não atinge.
  const maxSemJuros = maxParcelasSemJuros(
    total,
    faixasParcelamento
      .filter((f) => f.forma_pagamento === "cartao_credito")
      .map((f) => ({ valorMinimo: f.valor_minimo, parcelasSemJuros: f.parcelas_sem_juros })),
  );
  const parcelasSemJuros = formaPagamento === "cartao_credito" && numeroParcelas <= maxSemJuros;
  const parcelasComJuros = formaPagamento === "cartao_credito" && numeroParcelas > maxSemJuros;

  // Primeira compra / reativação (seção 10) — checagem client-side só pra
  // avisar cedo; a validação de verdade acontece no servidor dentro de
  // criar_pedido, que é quem realmente bloqueia.
  const minimoRequerido = (() => {
    if (!estatisticasCliente) return null;
    if (!estatisticasCliente.data_primeira_compra) return { valor: 1000, motivo: "primeira compra" };
    const meses = estatisticasCliente.meses_inatividade ?? 0;
    if (meses >= 12) return { valor: 800, motivo: "reativação (12+ meses sem comprar)" };
    if (meses >= 6) return { valor: 600, motivo: "reativação (6-11 meses sem comprar)" };
    return null;
  })();
  const abaixoDoMinimo = minimoRequerido !== null && carrinho.length > 0 && total < minimoRequerido.valor;

  // Prata 925 código≥20 (seção 10, decisão registrada em pending_decisions):
  // conta normalmente dentro do total geral pro mínimo de primeira compra —
  // não tem uma cota separada — mas fica exposto à parte pra dar
  // visibilidade ao vendedor, como o documento pede.
  const totalPrata925CodigoAlto = carrinho.reduce((soma, i) => {
    const material = (produtosPorId.get(i.produto_id)?.material ?? "").toLowerCase();
    const ehPrata925CodigoAlto = material.includes("prata") && material.includes("925") && i.codigo_peca >= 20;
    return ehPrata925CodigoAlto ? soma + i.quantidade * i.preco_unitario : soma;
  }, 0);

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
      const cotacao = produto.usa_cotacao_diaria
        ? cotacaoPorMaterial.get((produto.material ?? "").trim().toLowerCase())
        : undefined;
      const precoUnitario =
        cotacao != null && produto.peso != null
          ? calcularPrecoPorCotacao(produto.peso, cotacao, produto.multiplicador)
          : produto.preco;

      return [
        ...atual,
        {
          produto_id: produto.id,
          nome: produto.nome,
          quantidade: 1,
          codigo_peca: produto.codigo_peca,
          multiplicador: produto.multiplicador,
          preco_unitario: precoUnitario,
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
    setPagamentosMistos([
      { forma: "dinheiro", valor: "" },
      { forma: "pix", valor: "" },
    ]);
    setJustificativaExcecao("");
    setEstatisticasCliente(null);
    // Chave nova pra próxima venda — a antiga já foi consumida (ou nunca foi
    // usada, se essa tentativa deu erro antes de chegar no servidor).
    setIdempotencyKey(crypto.randomUUID());
  }

  function salvar(status: "orcamento" | "faturado" | "aguardando_lancamento_gmax") {
    if (!clienteSelecionado) {
      setErro("Selecione um cliente.");
      return;
    }
    if (carrinho.length === 0) {
      setErro("Adicione pelo menos um produto.");
      return;
    }
    // juroCartao = totalParaDividir - total: se o valor digitado pra "total
    // com juros da maquininha" for MENOR que o total do carrinho, isso vira
    // um acréscimo negativo — funcionaria como um desconto extra não
    // auditado (achado do code-review). O servidor também rejeita isso,
    // mas travar aqui evita gastar uma chamada só pra descobrir o erro.
    if (parcelasComJuros && juroCartao < 0) {
      setErro(
        `O valor com juros da maquininha (${formatarMoeda(totalParaDividir)}) não pode ser menor que o total da venda (${formatarMoeda(total)}).`,
      );
      return;
    }
    if (status !== "orcamento" && abaixoDoMinimo && !justificativaExcecao.trim()) {
      setErro(
        `Venda de ${minimoRequerido!.motivo} exige mínimo de ${formatarMoeda(minimoRequerido!.valor)} (valor atual: ${formatarMoeda(total)}). Informe a justificativa de exceção pra prosseguir abaixo do mínimo.`,
      );
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
    if (ehMisto) {
      const linhasValidas = pagamentosMistos.filter((p) => parseMoeda(p.valor) > 0);
      if (linhasValidas.length < 2) {
        setErro("Pagamento misto precisa de pelo menos duas formas com valor.");
        return;
      }
      if (Math.abs(somaPagamentosMistos - total) > 0.01) {
        setErro(
          `A soma das formas de pagamento (${formatarMoeda(somaPagamentosMistos)}) precisa bater com o total (${formatarMoeda(total)}).`,
        );
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
          percentualDesconto: temDescontoAutomatico
            ? descontoAutomatico.percentual * 100
            : percentualDesconto
              ? parseMoeda(percentualDesconto)
              : null,
          // Quando o cartão tem juros da maquininha, dobra a diferença no
          // acréscimo enviado pro servidor — ver comentário de juroCartao.
          valorAcrescimo: numAcrescimo + juroCartao,
          // Percentual de acréscimo perde sentido junto com juros de
          // cartão (o valor final não é mais um % simples do subtotal).
          percentualAcrescimo: juroCartao !== 0 ? null : percentualAcrescimo ? parseMoeda(percentualAcrescimo) : null,
        },
        parcelas,
        {
          idempotencyKey,
          parcelasPlanejadas: parcelas,
          excecaoJustificativa: justificativaExcecao.trim() || undefined,
          pagamentosMistos: ehMisto
            ? pagamentosMistos
                .filter((p) => parseMoeda(p.valor) > 0)
                .map((p) => ({ forma: p.forma, valor: parseMoeda(p.valor) }))
            : undefined,
        },
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
          <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-line bg-cream px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">{clienteSelecionado.nome}</span>
              <button
                type="button"
                onClick={() => {
                  setClienteSelecionado(null);
                  setEstatisticasCliente(null);
                }}
                className="text-xs font-semibold text-rose-deep hover:underline"
              >
                Trocar
              </button>
            </div>
            {clienteSelecionado.cpf_cnpj && (
              <span className="text-xs text-text-soft">CPF/CNPJ: {clienteSelecionado.cpf_cnpj}</span>
            )}
            {estatisticasCliente && (
              <span className="text-xs text-text-soft">
                {estatisticasCliente.data_primeira_compra
                  ? `Cliente desde ${formatarDataIso(estatisticasCliente.data_primeira_compra)} · total comprado ${formatarMoeda(estatisticasCliente.total_comprado)}`
                  : "Sem compras anteriores registradas — primeira compra"}
              </span>
            )}
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
                        setEstatisticasCliente(null);
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

        {temDescontoAutomatico ? (
          <div className="mb-3 flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-sm">
            <div className="flex justify-between text-text-soft">
              <span>Subtotal bruto</span>
              <span className="tabular-nums">{formatarMoeda(descontoAutomatico.subtotalBruto)}</span>
            </div>
            {descontoAutomatico.totalNaoElegivel > 0 && (
              <div className="flex justify-between text-text-soft">
                <span>Itens não elegíveis (fornitura)</span>
                <span className="tabular-nums">{formatarMoeda(descontoAutomatico.totalNaoElegivel)}</span>
              </div>
            )}
            <div className="flex justify-between text-text-soft">
              <span>Base elegível</span>
              <span className="tabular-nums">{formatarMoeda(descontoAutomatico.baseElegivel)}</span>
            </div>
            <div className="flex justify-between font-semibold text-ok">
              <span>Desconto automático ({(descontoAutomatico.percentual * 100).toFixed(0)}%)</span>
              <span className="tabular-nums">− {formatarMoeda(descontoAutomatico.valorDesconto)}</span>
            </div>
            <p className="mt-1 text-[0.7rem] text-text-soft">
              Aplicado automaticamente sobre a base elegível (seção 8) — fornitura nunca entra no cálculo.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Desconto (%)</label>
            <input
              value={temDescontoAutomatico ? (descontoAutomatico.percentual * 100).toFixed(0) : percentualDesconto}
              disabled={temDescontoAutomatico}
              onChange={(e) => {
                setPercentualDesconto(e.target.value);
                const p = Number(e.target.value.replace(",", "."));
                if (Number.isFinite(p)) setValorDesconto(((subtotal * p) / 100).toFixed(2));
              }}
              placeholder="0"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm disabled:opacity-60"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Desconto (R$)</label>
            <input
              value={temDescontoAutomatico ? descontoAutomatico.valorDesconto.toFixed(2) : valorDesconto}
              disabled={temDescontoAutomatico}
              onChange={(e) => setValorDesconto(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm disabled:opacity-60"
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
              ["debito", "Cartão de débito"],
              ["cartao_credito", "Cartão de crédito"],
              ["promissoria", "Promissória"],
              ["misto", "Pagamento misto"],
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
                    {n}x {n <= maxSemJuros ? "sem juros" : "com juros"}
                  </option>
                ))}
              </select>
              <p className="text-[0.7rem] text-text-soft">
                {maxSemJuros > 1
                  ? `Essa venda libera até ${maxSemJuros}x sem juros.`
                  : "Abaixo de R$200, só é liberado parcelamento com juros."}
              </p>
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
                  {formatarDataIso(somaMeses(primeiroVencimento, i))}{" "}
                  — <span className="font-semibold text-ink">{formatarMoeda(total / numeroParcelas)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ehMisto && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[0.7rem] text-text-soft">
              Sem desconto automático em pagamento misto (seção 16) — informe cada forma e o valor recebido nela; a
              soma precisa bater com o total.
            </p>
            {pagamentosMistos.map((linha, indice) => (
              <div key={indice} className="flex items-center gap-2">
                <select
                  value={linha.forma}
                  onChange={(e) =>
                    setPagamentosMistos((atual) =>
                      atual.map((l, i) => (i === indice ? { ...l, forma: e.target.value as FormaPagamento } : l)),
                    )
                  }
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                >
                  {(["dinheiro", "pix", "debito", "cartao_credito", "promissoria"] as const).map((f) => (
                    <option key={f} value={f}>
                      {f === "dinheiro"
                        ? "Dinheiro"
                        : f === "pix"
                          ? "Pix"
                          : f === "debito"
                            ? "Cartão de débito"
                            : f === "cartao_credito"
                              ? "Cartão de crédito"
                              : "Promissória"}
                    </option>
                  ))}
                </select>
                <input
                  value={linha.valor}
                  onChange={(e) =>
                    setPagamentosMistos((atual) =>
                      atual.map((l, i) => (i === indice ? { ...l, valor: e.target.value } : l)),
                    )
                  }
                  placeholder="Valor (R$)"
                  className="w-32 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                />
                {pagamentosMistos.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPagamentosMistos((atual) => atual.filter((_, i) => i !== indice))}
                    className="text-text-soft hover:text-crit"
                    aria-label="Remover forma de pagamento"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPagamentosMistos((atual) => [...atual, { forma: "dinheiro", valor: "" }])}
              className="w-fit rounded-full border border-line px-3 py-1 text-xs font-semibold text-rose-deep"
            >
              + Adicionar forma
            </button>
            <p className={`text-sm ${Math.abs(somaPagamentosMistos - total) > 0.01 ? "text-crit" : "text-ok"}`}>
              Soma: {formatarMoeda(somaPagamentosMistos)} / Total: {formatarMoeda(total)}
            </p>
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

      {itensSemCotacaoHoje.length > 0 && (
        <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs font-medium text-warn">
          {itensSemCotacaoHoje.map((i) => i.nome).join(", ")}: cotação do dia não informada — usando o preço já
          cadastrado do produto. Informe a cotação em Estoque pra usar o preço do dia.
        </p>
      )}

      {totalPrata925CodigoAlto > 0 && (
        <p className="rounded-lg bg-cream px-3 py-2 text-xs text-text-soft">
          Prata 925 código≥20 no carrinho: <strong className="text-ink">{formatarMoeda(totalPrata925CodigoAlto)}</strong>{" "}
          (conta normalmente no total do mínimo de primeira compra/reativação — seção 10)
        </p>
      )}

      {abaixoDoMinimo && minimoRequerido && (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-warn bg-warn-bg p-3 text-sm text-warn">
          <p className="font-semibold">
            Venda de {minimoRequerido.motivo} exige mínimo de {formatarMoeda(minimoRequerido.valor)} (valor atual:{" "}
            {formatarMoeda(total)}).
          </p>
          <label className="text-[0.7rem] font-semibold uppercase tracking-wide">
            Justificativa de exceção (exige permissão autorizada)
          </label>
          <input
            value={justificativaExcecao}
            onChange={(e) => setJustificativaExcecao(e.target.value)}
            placeholder="Motivo pra liberar abaixo do mínimo"
            className="rounded-lg border border-warn bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </div>
      )}

      {erro && (
        <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:items-center">
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
          className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
          title="Desconta estoque de verdade — use só quando essa venda for realmente saída do nosso estoque (loja/mostruário)"
        >
          Finalizar e faturar (afeta estoque)
        </button>
        <button
          type="button"
          disabled={salvando}
          onClick={() => salvar("aguardando_lancamento_gmax")}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-[#3b2914] disabled:opacity-60"
        >
          {salvando ? "Processando…" : "Registrar venda (lançar no GMax depois)"}
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
