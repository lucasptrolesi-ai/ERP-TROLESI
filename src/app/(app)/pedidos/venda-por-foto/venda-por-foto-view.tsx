"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { comprimirImagem, type ImagemComprimida } from "@/lib/comprimir-imagem";
import { analisarNotinha, anexarFotoNotinha } from "@/lib/actions/venda-por-foto";
import { criarPedido, buscarEstatisticasCliente } from "@/lib/actions/pedidos";
import { calcularPrecoUnitario } from "@/lib/precificacao";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { parseMoeda } from "@/lib/parse-moeda";
import { formatarDataIso } from "@/lib/datas";
import { ClienteForm } from "@/components/cliente-form";
import type { AnaliseNotinha, Cliente, EstatisticasCliente, FormaPagamento, ItemCarrinho, Produto } from "@/lib/types";

type ItemRevisao = {
  id: string;
  descricaoLida: string;
  produtoId: string | null;
  produtoNome: string | null;
  codigoPeca: string;
  multiplicador: string;
};

type PagamentoRevisao = { forma: FormaPagamento; valor: string };

// Promissória continua na lista (pra IA/vendedor conseguirem ver e
// escolher, e o select não ficar com um valor "órfão" fora das opções),
// mas handleConfirmar barra o envio se aparecer: essa tela sempre manda
// `parcelas: []` pro `criar_pedido` (a notinha não tem data de vencimento
// nem plano de parcelas), então uma perna promissória nunca geraria
// `contas_receber` — a dívida do cliente sumiria do sistema sem deixar
// rastro. Até essa tela ganhar um jeito de capturar vencimento/parcelas,
// promissória continua sendo lançada pela tela normal de Pedidos (achado em
// code review, 2026-08-11 — ver DECISIONS.md).
const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "cartao_credito", rotulo: "Crédito" },
  { valor: "promissoria", rotulo: "Promissória (não suportado aqui)" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function paraCampoNumero(n: number | null): string {
  return n != null ? String(n).replace(".", ",") : "";
}

// A notinha escreve a forma como texto livre ("crédito", "pix"...) — sem
// acento/maiúscula garantidos, então normaliza por trecho reconhecível em
// vez de igualdade exata. Sem correspondência clara, cai em cartão de
// crédito (a forma mais comum quando a nota só diz "crédito"/"cartão").
// Continua reconhecendo "promiss…" (em vez de cair no fallback errado) só
// pra handleConfirmar conseguir barrar e explicar o motivo — ver nota em
// FORMAS acima.
function normalizarForma(formaLida: string): FormaPagamento {
  const f = formaLida.toLowerCase();
  if (f.includes("pix")) return "pix";
  if (f.includes("dinheiro") || f.includes("especie") || f.includes("espécie")) return "dinheiro";
  if (f.includes("debito") || f.includes("débito")) return "debito";
  if (f.includes("promiss")) return "promissoria";
  return "cartao_credito";
}

function candidatosProduto(descricao: string, produtos: Produto[]): Produto[] {
  const termo = descricao.toLowerCase();
  const porAtributo = produtos.filter(
    (p) =>
      (termo.includes("corrente") && p.eh_correntaria) ||
      (termo.includes("embalagem") && p.eh_embalagem) ||
      (termo.includes("fornitura") && p.eh_fornitura) ||
      (termo.includes("fita") && p.eh_fita) ||
      (termo.includes("fio") && p.eh_fio),
  );
  if (porAtributo.length > 0) return porAtributo.slice(0, 5);
  return produtos
    .filter((p) => p.nome.toLowerCase().includes(termo) || termo.includes(p.nome.toLowerCase()))
    .slice(0, 5);
}

export function VendaPorFotoView({ clientes, produtos }: { clientes: Cliente[]; produtos: Produto[] }) {
  const router = useRouter();
  const [passo, setPasso] = useState<1 | 2 | 3 | 4>(1);
  const [foto, setFoto] = useState<ImagemComprimida | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [analisando, iniciarAnalise] = useTransition();
  const [analise, setAnalise] = useState<AnaliseNotinha | null>(null);
  const [dataLida, setDataLida] = useState<string | null>(null);

  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [novoClienteAberto, setNovoClienteAberto] = useState(false);
  const [estatisticasCliente, setEstatisticasCliente] = useState<EstatisticasCliente | null>(null);
  const [justificativaExcecao, setJustificativaExcecao] = useState("");

  const [itens, setItens] = useState<ItemRevisao[]>([]);
  const [trocandoProdutoId, setTrocandoProdutoId] = useState<string | null>(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [pagamentos, setPagamentos] = useState<PagamentoRevisao[]>([]);

  const [salvando, iniciarSalvamento] = useTransition();
  const [resultado, setResultado] = useState<{ pedidoId: string; avisoFoto?: string } | null>(null);

  const clientesFiltrados = useMemo(() => {
    const termo = buscaCliente.trim().toLowerCase();
    if (!termo) return [];
    return clientes.filter((c) => c.nome.toLowerCase().includes(termo)).slice(0, 6);
  }, [clientes, buscaCliente]);

  const produtosFiltrados = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return produtos
      .filter((p) => p.nome.toLowerCase().includes(termo) || p.categoria.toLowerCase().includes(termo))
      .slice(0, 8);
  }, [produtos, buscaProduto]);

  function produtoPorId(id: string | null): Produto | null {
    return produtos.find((p) => p.id === id) ?? null;
  }

  // `|| produto.multiplicador` trataria um "0" digitado de propósito como
  // "campo vazio" e devolveria o multiplicador padrão do produto por baixo
  // dos panos — só cai no padrão quando o campo está mesmo em branco.
  function multiplicadorEfetivo(item: ItemRevisao, produto: Produto | null): number {
    return item.multiplicador.trim() === "" ? (produto?.multiplicador ?? 0) : parseMoeda(item.multiplicador);
  }

  function valorItem(item: ItemRevisao): number {
    const codigo = parseMoeda(item.codigoPeca);
    const multiplicador = multiplicadorEfetivo(item, produtoPorId(item.produtoId));
    return calcularPrecoUnitario(codigo, multiplicador);
  }

  const totalCalculado = itens.reduce((soma, i) => soma + valorItem(i), 0);
  const totalPagamentos = pagamentos.reduce((soma, p) => soma + (parseMoeda(p.valor) || 0), 0);
  const totalBateComNota = analise?.total == null || itens.length === 0 || Math.abs(totalCalculado - analise.total) <= 0.01;
  const pagamentoBateComTotal = itens.length === 0 || Math.abs(totalPagamentos - totalCalculado) <= 0.01;
  const ehMisto = pagamentos.length > 1;

  // Mesma regra de mínimo por primeira compra/reativação que a tela manual
  // de pedido já aplica (seção 10 do documento mestre) — aviso antecipado
  // só, quem bloqueia de verdade é o `criar_pedido` no servidor.
  useEffect(() => {
    if (!clienteSelecionado) {
      setEstatisticasCliente(null);
      return;
    }
    buscarEstatisticasCliente(clienteSelecionado.id).then(setEstatisticasCliente);
  }, [clienteSelecionado]);

  const minimoRequerido = (() => {
    if (!estatisticasCliente) return null;
    if (!estatisticasCliente.data_primeira_compra) return { valor: 1000, motivo: "primeira compra" };
    const meses = estatisticasCliente.meses_inatividade ?? 0;
    if (meses >= 12) return { valor: 800, motivo: "reativação (12+ meses sem comprar)" };
    if (meses >= 6) return { valor: 600, motivo: "reativação (6-11 meses sem comprar)" };
    return null;
  })();
  const abaixoDoMinimo = minimoRequerido !== null && itens.length > 0 && totalCalculado < minimoRequerido.valor;

  function limpar() {
    setPasso(1);
    setFoto(null);
    setAnalise(null);
    setDataLida(null);
    setClienteSelecionado(null);
    setBuscaCliente("");
    setItens([]);
    setPagamentos([]);
    setResultado(null);
    setErro(null);
  }

  async function handleSelecionarFoto(arquivo: File) {
    try {
      const comprimida = await comprimirImagem(arquivo);
      setFoto(comprimida);
      setErro(null);
    } catch {
      setErro("Não foi possível ler a foto. Tente outra.");
    }
  }

  function handleAnalisar() {
    if (!foto) {
      setErro("Fotografe ou envie a notinha primeiro.");
      return;
    }
    setErro(null);
    setPasso(2);
    iniciarAnalise(async () => {
      const resposta = await analisarNotinha({ base64: foto.base64, mediaType: foto.mediaType });
      if (resposta.erro || !resposta.resultado) {
        setErro(resposta.erro ?? "Não foi possível ler a notinha.");
        setPasso(1);
        return;
      }
      const a = resposta.resultado;
      setAnalise(a);
      setDataLida(a.data);

      const clienteLido = (a.cliente ?? "").trim().toLowerCase();
      const clienteEncontrado = clienteLido ? clientes.find((c) => c.nome.toLowerCase() === clienteLido) : undefined;
      setClienteSelecionado(clienteEncontrado ?? null);
      setBuscaCliente(clienteEncontrado ? "" : (a.cliente ?? ""));

      setItens(
        a.itens.map((item, i) => {
          const candidato = candidatosProduto(item.descricao, produtos)[0] ?? null;
          const multiplicadorLido = item.multiplicador ?? candidato?.multiplicador ?? null;
          // Linha sem código nem multiplicador escritos, mas com o valor da
          // linha lido (ex: "Embalagem" avulsa) — reconstrói o código a
          // partir do valor pra manter código × multiplicador = valor.
          const codigoPeca =
            item.codigo_peca ??
            (item.valor_linha != null && multiplicadorLido ? round2(item.valor_linha / multiplicadorLido) : 0);
          return {
            id: `item-${i}-${crypto.randomUUID()}`,
            descricaoLida: item.descricao,
            produtoId: candidato?.id ?? null,
            produtoNome: candidato?.nome ?? null,
            codigoPeca: paraCampoNumero(codigoPeca),
            multiplicador: paraCampoNumero(multiplicadorLido),
          };
        }),
      );

      setPagamentos(a.pagamentos.map((p) => ({ forma: normalizarForma(p.forma), valor: paraCampoNumero(p.valor) })));

      setPasso(3);
    });
  }

  function atualizarItem(id: string, campo: "codigoPeca" | "multiplicador", valor: string) {
    setItens((atual) => atual.map((i) => (i.id === id ? { ...i, [campo]: valor } : i)));
  }

  function trocarProdutoItem(id: string, produto: Produto) {
    setItens((atual) =>
      atual.map((i) =>
        i.id === id
          ? {
              ...i,
              produtoId: produto.id,
              produtoNome: produto.nome,
              multiplicador: i.multiplicador || paraCampoNumero(produto.multiplicador),
            }
          : i,
      ),
    );
    setTrocandoProdutoId(null);
    setBuscaProduto("");
  }

  function removerItem(id: string) {
    setItens((atual) => atual.filter((i) => i.id !== id));
  }

  function adicionarItemManual() {
    const id = `item-manual-${crypto.randomUUID()}`;
    setItens((atual) => [
      ...atual,
      { id, descricaoLida: "(item adicionado manualmente)", produtoId: null, produtoNome: null, codigoPeca: "", multiplicador: "" },
    ]);
    setTrocandoProdutoId(id);
  }

  function atualizarPagamento(indice: number, campo: "forma" | "valor", valor: string) {
    setPagamentos((atual) => atual.map((p, i) => (i === indice ? ({ ...p, [campo]: valor } as PagamentoRevisao) : p)));
  }

  function adicionarPagamento() {
    setPagamentos((atual) => [...atual, { forma: "dinheiro", valor: "" }]);
  }

  function removerPagamento(indice: number) {
    setPagamentos((atual) => atual.filter((_, i) => i !== indice));
  }

  function handleConfirmar() {
    setErro(null);
    if (!clienteSelecionado) {
      setErro("Selecione ou cadastre o cliente antes de confirmar.");
      return;
    }
    if (itens.length === 0) {
      setErro("Adicione pelo menos um item.");
      return;
    }
    for (const item of itens) {
      if (!item.produtoId) {
        setErro(`Selecione o produto correspondente a "${item.descricaoLida}".`);
        return;
      }
      if (parseMoeda(item.codigoPeca) <= 0) {
        setErro(`Informe um código da peça válido para "${item.produtoNome ?? item.descricaoLida}".`);
        return;
      }
      if (valorItem(item) <= 0) {
        setErro(`O valor calculado para "${item.produtoNome ?? item.descricaoLida}" ficou zerado — confira o multiplicador.`);
        return;
      }
    }
    if (pagamentos.length === 0 || pagamentos.some((p) => parseMoeda(p.valor) <= 0)) {
      setErro("Informe ao menos uma forma de pagamento com valor.");
      return;
    }
    if (pagamentos.some((p) => p.forma === "promissoria")) {
      setErro(
        "Essa tela ainda não lança promissória (não captura vencimento/parcelas — a dívida ficaria sem registro). Lance essa venda pela tela normal de Pedidos.",
      );
      return;
    }
    if (!pagamentoBateComTotal) {
      setErro(
        `A soma das formas de pagamento (${formatarMoeda(totalPagamentos)}) não bate com o total calculado (${formatarMoeda(totalCalculado)}).`,
      );
      return;
    }
    if (abaixoDoMinimo && !justificativaExcecao.trim()) {
      setErro(
        `Venda de ${minimoRequerido!.motivo} exige mínimo de ${formatarMoeda(minimoRequerido!.valor)} (valor atual: ${formatarMoeda(totalCalculado)}). Informe a justificativa de exceção pra prosseguir abaixo do mínimo.`,
      );
      return;
    }

    const carrinho: ItemCarrinho[] = itens.map((item) => {
      const produto = produtoPorId(item.produtoId)!;
      const codigo = parseMoeda(item.codigoPeca);
      const multiplicador = multiplicadorEfetivo(item, produto);
      return {
        linha_id: crypto.randomUUID(),
        produto_id: produto.id,
        nome: produto.nome,
        quantidade: 1,
        codigo_peca: codigo,
        multiplicador,
        preco_unitario: calcularPrecoUnitario(codigo, multiplicador),
        estoqueDisponivel: produto.quantidade_estoque,
      };
    });

    const formaPagamento: FormaPagamento = ehMisto ? "misto" : pagamentos[0].forma;

    iniciarSalvamento(async () => {
      const resposta = await criarPedido(
        clienteSelecionado.id,
        carrinho,
        formaPagamento,
        "faturado",
        { valorDesconto: 0, percentualDesconto: null, valorAcrescimo: 0, percentualAcrescimo: null },
        [],
        {
          idempotencyKey: crypto.randomUUID(),
          excecaoJustificativa: justificativaExcecao.trim() || undefined,
          pagamentosMistos: ehMisto
            ? pagamentos.map((p) => ({ forma: p.forma, valor: parseMoeda(p.valor) }))
            : undefined,
        },
      );

      if (resposta.erro || !resposta.pedidoId) {
        setErro(resposta.erro ?? "Não foi possível lançar o pedido.");
        return;
      }

      let avisoFoto: string | undefined;
      if (foto) {
        const respostaFoto = await anexarFotoNotinha(resposta.pedidoId, { base64: foto.base64, mediaType: foto.mediaType });
        avisoFoto = respostaFoto.erro;
      }

      router.refresh();
      setResultado({ pedidoId: resposta.pedidoId, avisoFoto });
      setPasso(4);
    });
  }

  const etapas = ["Enviar foto", "Lendo", "Revisar", "Confirmação"];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <span className="text-[0.7rem] font-bold uppercase tracking-wide text-rose-deep">PDV · Novo lançamento</span>
          <h1 className="font-display text-2xl font-semibold text-ink">Lançar venda por foto</h1>
        </div>
        <Link href="/pedidos" className="text-sm font-semibold text-text-soft hover:text-ink">
          ← Voltar
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-4 gap-1">
        {etapas.map((nome, i) => (
          <div key={nome} className="flex flex-col items-center gap-1.5">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                passo === i + 1
                  ? "bg-gradient-to-br from-gold-start to-gold-end text-gold-ink"
                  : "border border-line bg-surface text-text-soft"
              }`}
            >
              {i + 1}
            </div>
            <span className="hidden text-[0.62rem] font-bold uppercase text-text-soft sm:block">{nome}</span>
          </div>
        ))}
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-5 shadow-sm">
        {erro && <p role="alert" className="mb-4 rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">{erro}</p>}

        {passo === 1 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold text-ink">Fotografe a notinha</h2>
            <p className="mb-4 text-sm text-text-soft">
              Boa luz, nota inteira no quadro — capriche no total e na forma de pagamento.
            </p>
            <label
              className={`flex aspect-[3/4] max-w-xs flex-col items-center justify-center gap-2 rounded-2xl border-2 text-center ${
                foto ? "border-transparent" : "cursor-pointer border-dashed border-line bg-cream"
              }`}
            >
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  e.target.value = "";
                  if (arquivo) handleSelecionarFoto(arquivo);
                }}
              />
              {foto ? (
                // eslint-disable-next-line @next/next/no-img-element -- prévia local (data URL)
                <img src={foto.dataUrl} alt="Notinha" className="h-full w-full rounded-2xl object-cover" />
              ) : (
                <span className="text-[0.7rem] font-bold uppercase tracking-wide text-text-soft">
                  Tirar foto ou escolher arquivo
                </span>
              )}
            </label>
            <div className="mt-5 flex justify-end">
              <button
                onClick={handleAnalisar}
                disabled={!foto}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-50"
              >
                Ler notinha com IA →
              </button>
            </div>
          </div>
        )}

        {passo === 2 && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-rose-soft border-t-rose-deep" />
            <p className="text-sm font-semibold text-ink">{analisando ? "Lendo a notinha…" : "Quase lá…"}</p>
          </div>
        )}

        {passo === 3 && (
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
              {foto && (
                // eslint-disable-next-line @next/next/no-img-element -- prévia local (data URL)
                <img src={foto.dataUrl} alt="Notinha" className="max-h-64 w-full rounded-xl border border-line object-contain sm:max-h-none" />
              )}
              <div className="flex flex-col gap-3">
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
                          placeholder="Buscar cliente por nome"
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
                        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border-2 border-rose-soft bg-cream shadow-lg">
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
                                {c.nome}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-warn">nome lido na nota: “{analise?.cliente ?? "—"}”</p>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Data na notinha</label>
                  <p className="mt-1.5 rounded-lg border border-line bg-cream px-3 py-2 text-sm text-text-soft">
                    {dataLida ?? "não identificada"} — o pedido grava com a data/hora de hoje, não com a da nota.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Itens</h3>
                <button type="button" onClick={adicionarItemManual} className="text-xs font-semibold text-rose-deep hover:underline">
                  + Adicionar item
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {itens.map((item) => (
                  <div key={item.id} className="rounded-xl border border-line bg-cream p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        {item.produtoNome ? (
                          <p className="text-sm font-bold text-ink">{item.produtoNome}</p>
                        ) : (
                          <p className="text-sm font-bold text-crit">Nenhum produto selecionado</p>
                        )}
                        <p className="text-xs text-text-soft">lido como “{item.descricaoLida}”</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setTrocandoProdutoId(trocandoProdutoId === item.id ? null : item.id);
                            setBuscaProduto("");
                          }}
                          className="text-xs font-semibold text-rose-deep hover:underline"
                        >
                          trocar produto
                        </button>
                        <button type="button" onClick={() => removerItem(item.id)} className="text-xs font-semibold text-text-soft hover:text-crit">
                          remover
                        </button>
                      </div>
                    </div>

                    {trocandoProdutoId === item.id && (
                      <div className="relative mt-2">
                        <input
                          autoFocus
                          value={buscaProduto}
                          onChange={(e) => setBuscaProduto(e.target.value)}
                          placeholder="Buscar produto por nome ou categoria"
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
                        />
                        {produtosFiltrados.length > 0 && (
                          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border-2 border-rose-soft bg-surface shadow-lg">
                            {produtosFiltrados.map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onClick={() => trocarProdutoItem(item.id, p)}
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-rose-soft/40"
                                >
                                  {p.nome} <span className="text-text-soft">— {p.categoria}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-soft">Código</label>
                        <input
                          value={item.codigoPeca}
                          onChange={(e) => atualizarItem(item.id, "codigoPeca", e.target.value)}
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-rose"
                        />
                      </div>
                      <div>
                        <label className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-soft">Multiplicador</label>
                        <input
                          value={item.multiplicador}
                          onChange={(e) => atualizarItem(item.id, "multiplicador", e.target.value)}
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-rose"
                        />
                      </div>
                      <div>
                        <label className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-soft">Valor</label>
                        <p className="mt-1 rounded-lg border border-line bg-cream px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-ink">
                          {formatarMoeda(valorItem(item))}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {itens.length === 0 && <p className="text-sm text-text-soft">Nenhum item lido — adicione manualmente.</p>}
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg bg-cream px-3 py-2">
                <span className="text-sm font-semibold text-ink">Total dos itens</span>
                <span className="text-base font-bold tabular-nums text-ink">{formatarMoeda(totalCalculado)}</span>
              </div>
              {!totalBateComNota && (
                <p className="mt-2 rounded-lg bg-warn-bg px-3 py-2 text-xs font-medium text-warn">
                  O total calculado não bate com o total escrito na nota ({formatarMoeda(analise?.total ?? 0)}). Confira os itens.
                </p>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Forma de pagamento{ehMisto ? " — misto" : ""}</h3>
                <button type="button" onClick={adicionarPagamento} className="text-xs font-semibold text-rose-deep hover:underline">
                  + Adicionar forma
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {pagamentos.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={p.forma}
                      onChange={(e) => atualizarPagamento(i, "forma", e.target.value)}
                      className="rounded-lg border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-rose"
                    >
                      {FORMAS.map((f) => (
                        <option key={f.valor} value={f.valor}>
                          {f.rotulo}
                        </option>
                      ))}
                    </select>
                    <input
                      value={p.valor}
                      onChange={(e) => atualizarPagamento(i, "valor", e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="w-28 rounded-lg border border-line bg-cream px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-rose"
                    />
                    {pagamentos.length > 1 && (
                      <button type="button" onClick={() => removerPagamento(i)} className="text-xs font-semibold text-text-soft hover:text-crit">
                        remover
                      </button>
                    )}
                  </div>
                ))}
                {pagamentos.length === 0 && <p className="text-sm text-text-soft">Nenhuma forma de pagamento lida — adicione manualmente.</p>}
              </div>
              {pagamentos.length > 0 && (
                <p className={`mt-2 text-xs font-semibold ${pagamentoBateComTotal ? "text-ok" : "text-crit"}`}>
                  {pagamentoBateComTotal ? "✓ soma bate com o total" : `soma atual: ${formatarMoeda(totalPagamentos)}`}
                </p>
              )}
            </div>

            {abaixoDoMinimo && minimoRequerido && (
              <div className="rounded-lg bg-warn-bg px-3 py-2.5 text-sm text-warn">
                <p className="font-semibold">
                  Venda de {minimoRequerido.motivo} exige mínimo de {formatarMoeda(minimoRequerido.valor)} (valor atual:{" "}
                  {formatarMoeda(totalCalculado)}).
                </p>
                <input
                  value={justificativaExcecao}
                  onChange={(e) => setJustificativaExcecao(e.target.value)}
                  placeholder="Justificativa de exceção pra liberar abaixo do mínimo"
                  className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose"
                />
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setPasso(1);
                  setJustificativaExcecao("");
                }}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream"
              >
                ← Trocar foto
              </button>
              <button
                onClick={handleConfirmar}
                disabled={salvando}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
              >
                {salvando ? "Lançando…" : "Confirmar e lançar pedido"}
              </button>
            </div>
          </div>
        )}

        {passo === 4 && resultado && (
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-bg text-lg font-black text-ok">✓</div>
              <h2 className="text-lg font-semibold text-ink">Pedido lançado com sucesso</h2>
            </div>
            {resultado.avisoFoto && (
              <p className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm font-medium text-warn">{resultado.avisoFoto}</p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <a
                href={`/pedidos/${resultado.pedidoId}/cupom`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink hover:bg-cream"
              >
                🧾 Imprimir cupom
              </a>
              <button onClick={limpar} className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream">
                Lançar outra venda por foto
              </button>
              <Link href="/pedidos" className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-center text-sm font-semibold text-gold-ink">
                Ver em Pedidos
              </Link>
            </div>
          </div>
        )}
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
