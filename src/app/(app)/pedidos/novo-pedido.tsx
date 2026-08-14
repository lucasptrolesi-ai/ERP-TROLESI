"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClienteForm } from "@/components/cliente-form";
import { criarPedido, buscarEstatisticasCliente } from "@/lib/actions/pedidos";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { parseMoeda } from "@/lib/parse-moeda";
import { formatarDataIso, hojeIso } from "@/lib/datas";
import { calcularPrecoPorCotacao, calcularPrecoUnitario } from "@/lib/precificacao";
import { maxParcelasSemJuros } from "@/lib/parcelamento";
import { CHAVE_RASCUNHO_PEDIDO } from "@/lib/rascunho-pedido";
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

// Só os campos que representam a venda em andamento — buscas, buffers de
// edição, modal de "novo cliente" e estado pós-envio (pedidoCriado etc.)
// ficam de fora de propósito, ver comentário junto do useEffect de rascunho.
type RascunhoPedido = {
  clienteSelecionado: Cliente | null;
  carrinho: ItemCarrinho[];
  percentualDesconto: string;
  valorDesconto: string;
  percentualAcrescimo: string;
  valorAcrescimo: string;
  formaPagamento: FormaPagamento;
  numeroParcelas: number;
  primeiroVencimento: string;
  valorComJuros: string;
  pagamentosMistos: { forma: FormaPagamento; valor: string }[];
  justificativaExcecao: string;
  idempotencyKey: string;
};

// Leitura do rascunho via useSyncExternalStore (mesmo padrão de
// alerta-vencimentos.tsx): no servidor não existe sessionStorage, então o
// snapshot do servidor não pode ler o valor real — evita mismatch de
// hidratação (e o lint do projeto já rejeita ler storage num useEffect e
// disparar setState direto, ver aplicação do rascunho dentro do
// componente). `pronto: false` no servidor (e na primeira pintura do
// cliente, que usa o mesmo snapshot pra bater com o HTML hidratado) marca
// "ainda não sei se existe rascunho" — sem esse flag, um F5 de verdade
// (SSR + hidratação) não dá tempo do efeito de salvar rodar só depois da
// correção do useSyncExternalStore, e ele grava o estado padrão vazio por
// cima do rascunho antes dele ser lido (bug visto ao testar reload).
// Cache por string bruta porque getSnapshot precisa devolver a mesma
// referência enquanto o conteúdo salvo não mudar, senão
// useSyncExternalStore entende que o valor muda a cada chamada e loopa.
type LeituraRascunho = { pronto: false } | { pronto: true; dados: RascunhoPedido | null };

const LEITURA_SERVIDOR: LeituraRascunho = { pronto: false };

let cacheRascunhoBruto: string | null | undefined;
let cacheRascunhoLeitura: LeituraRascunho | undefined;

function lerRascunho(): LeituraRascunho {
  const bruto = sessionStorage.getItem(CHAVE_RASCUNHO_PEDIDO);
  if (bruto === cacheRascunhoBruto && cacheRascunhoLeitura) return cacheRascunhoLeitura;
  cacheRascunhoBruto = bruto;
  let dados: RascunhoPedido | null = null;
  try {
    dados = bruto ? (JSON.parse(bruto) as RascunhoPedido) : null;
  } catch {
    dados = null;
  }
  cacheRascunhoLeitura = { pronto: true, dados };
  return cacheRascunhoLeitura;
}

function lerRascunhoNoServidor(): LeituraRascunho {
  return LEITURA_SERVIDOR;
}

function inscreverRascunho(avisar: () => void) {
  window.addEventListener("storage", avisar);
  return () => window.removeEventListener("storage", avisar);
}

/** Handler de ArrowUp/ArrowDown/Enter pra combobox de busca — mesmo
 * comportamento nas duas listas (cliente e produto) do PDV, só muda a lista
 * e o que "selecionar" faz em cada uma. */
function aoNavegarLista<T>(
  itens: T[],
  indiceAtivo: number,
  setIndiceAtivo: (atualizar: (i: number) => number) => void,
  selecionar: (item: T) => void,
) {
  return (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (itens.length === 0) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setIndiceAtivo((i) => Math.min(i + 1, itens.length - 1));
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setIndiceAtivo((i) => Math.max(i - 1, 0));
    } else if (evento.key === "Enter") {
      const item = itens[indiceAtivo];
      if (item) {
        evento.preventDefault();
        selecionar(item);
      }
    }
  };
}

function somaMeses(dataIso: string, meses: number): string {
  const data = new Date(`${dataIso}T00:00:00`);
  data.setMonth(data.getMonth() + meses);
  return data.toISOString().slice(0, 10);
}

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
  const [indiceClienteAtivo, setIndiceClienteAtivo] = useState(0);
  const [novoClienteAberto, setNovoClienteAberto] = useState(false);
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [indiceProdutoAtivo, setIndiceProdutoAtivo] = useState(0);
  // Buffer de texto por linha do carrinho (qtd./código) — sem isso, o campo
  // é controlado direto por um número já clampado (`value={i.quantidade}`):
  // apagar o dígito pra digitar um valor novo passa por "" no meio do
  // caminho, o clamp (`|| 1`) transforma isso de volta em 1 antes do
  // próximo toque, e o campo nunca fica vazio de verdade — só dava pra
  // mudar o valor pelas setinhas do input number. Aqui o campo mostra
  // exatamente o que foi digitado (mesmo inválido/vazio) até perder o foco;
  // o carrinho só é atualizado quando o texto já é um número válido.
  const [edicaoQuantidade, setEdicaoQuantidade] = useState<Record<string, string>>({});
  const [edicaoCodigo, setEdicaoCodigo] = useState<Record<string, string>>({});

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
  const [avisoPopupBloqueado, setAvisoPopupBloqueado] = useState(false);
  const router = useRouter();

  // Venda em andamento não pode se perder ao navegar pra Estoque/Cadastros e
  // voltar (o React desmonta esse componente na troca de rota) — guarda um
  // rascunho no sessionStorage a cada mudança (efeito abaixo) e restaura ao
  // montar de novo. leituraRascunho vem do useSyncExternalStore acima:
  // `pronto: false` no servidor/primeira pintura (sem mismatch de
  // hidratação), e a leitura real logo em seguida, já no cliente.
  const leituraRascunho = useSyncExternalStore(inscreverRascunho, lerRascunho, lerRascunhoNoServidor);
  const [rascunhoAplicado, setRascunhoAplicado] = useState(false);

  // Aplicar durante a renderização (não num useEffect) é o padrão que o
  // React recomenda pra inicializar estado a partir de algo só disponível
  // depois do primeiro render sem gastar um round-trip de efeito — e é
  // exatamente o que o lint do projeto pede ao rejeitar setState direto
  // dentro de useEffect. O guard usa estado (não ref — o lint também
  // rejeita ler ref.current durante a renderização) pra aplicar uma vez só.
  if (leituraRascunho.pronto && !rascunhoAplicado) {
    setRascunhoAplicado(true);
    const dados = leituraRascunho.dados;
    if (dados) {
      setClienteSelecionado(dados.clienteSelecionado);
      setCarrinho(dados.carrinho);
      setPercentualDesconto(dados.percentualDesconto);
      setValorDesconto(dados.valorDesconto);
      setPercentualAcrescimo(dados.percentualAcrescimo);
      setValorAcrescimo(dados.valorAcrescimo);
      setFormaPagamento(dados.formaPagamento);
      setNumeroParcelas(dados.numeroParcelas);
      setPrimeiroVencimento(dados.primeiroVencimento);
      setValorComJuros(dados.valorComJuros);
      setPagamentosMistos(dados.pagamentosMistos);
      setJustificativaExcecao(dados.justificativaExcecao);
      setIdempotencyKey(dados.idempotencyKey);
    }
  }

  useEffect(() => {
    // Só grava depois que a leitura real (client-side) do rascunho já foi
    // resolvida e aplicada acima — senão esse efeito roda primeiro, ainda
    // com o estado padrão vazio, e sobrescreve o rascunho salvo antes dele
    // ser restaurado (bug visto especificamente num F5/reload completo,
    // que passa por SSR+hidratação de verdade — a troca de rota client-side
    // não sofre disso, mas o reload sim).
    if (!rascunhoAplicado) return;
    const rascunho: RascunhoPedido = {
      clienteSelecionado,
      carrinho,
      percentualDesconto,
      valorDesconto,
      percentualAcrescimo,
      valorAcrescimo,
      formaPagamento,
      numeroParcelas,
      primeiroVencimento,
      valorComJuros,
      pagamentosMistos,
      justificativaExcecao,
      idempotencyKey,
    };
    try {
      sessionStorage.setItem(CHAVE_RASCUNHO_PEDIDO, JSON.stringify(rascunho));
    } catch {
      // sessionStorage indisponível/cheio — segue sem persistir.
    }
  }, [
    rascunhoAplicado,
    clienteSelecionado,
    carrinho,
    percentualDesconto,
    valorDesconto,
    percentualAcrescimo,
    valorAcrescimo,
    formaPagamento,
    numeroParcelas,
    primeiroVencimento,
    valorComJuros,
    pagamentosMistos,
    justificativaExcecao,
    idempotencyKey,
  ]);

  // Ao fechar a venda, abre o cupom sozinho numa aba nova — lá, o próprio
  // cupom já dispara a impressão da via loja automaticamente (ver
  // cupom-view.tsx). Se o navegador bloquear a aba (bloqueador de pop-up),
  // avisa e deixa o link manual abaixo como saída.
  useEffect(() => {
    if (!pedidoCriado) return;
    const t = setTimeout(() => {
      const aba = window.open(`/pedidos/${pedidoCriado.id}/cupom`, "_blank", "noopener,noreferrer");
      setAvisoPopupBloqueado(!aba);
    }, 0);
    return () => clearTimeout(t);
  }, [pedidoCriado]);

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
  const indiceClienteClampado = Math.min(indiceClienteAtivo, Math.max(0, clientesFiltrados.length - 1));

  function selecionarCliente(c: Cliente) {
    setClienteSelecionado(c);
    setEstatisticasCliente(null);
    setBuscaCliente("");
  }

  const produtosFiltrados = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return produtos
      .filter(
        (p) =>
          p.nome.toLowerCase().includes(termo) ||
          p.categoria.toLowerCase().includes(termo) ||
          (p.codigo_interno ?? "").toLowerCase().includes(termo) ||
          (p.colecao ?? "").toLowerCase().includes(termo),
      )
      .slice(0, 8);
  }, [produtos, buscaProduto]);
  const indiceProdutoClampado = Math.min(indiceProdutoAtivo, Math.max(0, produtosFiltrados.length - 1));

  const subtotal = carrinho.reduce((soma, i) => soma + i.quantidade * i.preco_unitario, 0);

  // Estoque negativo é autorizado (2026-07-21) — isso é só um aviso
  // informativo, não bloqueia a venda.
  const itensAcimaDoEstoque = carrinho.filter((i) => i.quantidade > i.estoqueDisponivel);

  const itensSemCotacaoHoje = carrinho.filter((i) => {
    const produto = produtosPorId.get(i.produto_id);
    if (!produto?.usa_cotacao_diaria) return false;
    return cotacaoPorMaterial.get((produto.material ?? "").trim().toLowerCase()) == null;
  });

  // Desconto sempre manual (a pedido do usuário — o automático por forma de
  // pagamento foi removido) — o vendedor ajusta quando necessário, pra
  // qualquer forma de pagamento.
  const numDesconto = parseMoeda(valorDesconto);
  const numAcrescimo = parseMoeda(valorAcrescimo);
  const total = Math.max(0, subtotal - numDesconto + numAcrescimo);

  const ehPromissoria = formaPagamento === "promissoria";
  const ehMisto = formaPagamento === "misto";
  const somaPagamentosMistos = pagamentosMistos.reduce((s, p) => s + (parseMoeda(p.valor) || 0), 0);
  // Achado em code review (2026-08-11, ver DECISIONS.md): pagamento misto
  // com perna promissória salvava a venda sem gerar contas_receber — a
  // dívida sumia do sistema, porque `temParcelamento`/`totalParaDividir`
  // só conheciam promissória "pura". A perna promissória dentro do misto
  // agora também vira parcelas — só que sobre o valor DELA, não da venda
  // inteira (o resto do misto já foi recebido nas outras formas).
  const valorPromissoriaMisto = ehMisto
    ? pagamentosMistos.filter((p) => p.forma === "promissoria").reduce((s, p) => s + (parseMoeda(p.valor) || 0), 0)
    : 0;
  const temPromissoriaEmMisto = ehMisto && valorPromissoriaMisto > 0;
  const temParcelamento = formaPagamento === "cartao_credito" || ehPromissoria || temPromissoriaEmMisto;

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
  // Já na promissória dentro do misto, divide só a perna promissória —
  // o restante do total já foi recebido nas outras formas de pagamento.
  const totalParaDividir = parcelasComJuros
    ? parseMoeda(valorComJuros)
    : temPromissoriaEmMisto
      ? valorPromissoriaMisto
      : total;

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
    // Cada clique cria uma linha nova, mesmo que o produto já esteja no
    // carrinho — nunca soma quantidade numa linha existente (pedido do
    // usuário, 2026-07-29: duas peças "iguais" no cadastro podem ter
    // peso/código diferente cada uma, e o campo "Código" da linha só faz
    // sentido editável por unidade se cada peça física tiver sua própria
    // linha).
    setCarrinho((atual) => {
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
          linha_id: crypto.randomUUID(),
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

  function alterarQuantidade(linhaId: string, quantidade: number) {
    setCarrinho((atual) =>
      atual.map((i) => (i.linha_id === linhaId ? { ...i, quantidade: Math.max(1, quantidade) } : i)),
    );
  }

  function alterarCodigoPeca(linhaId: string, codigoPeca: number) {
    const codigoValido = Math.max(0, codigoPeca);
    setCarrinho((atual) =>
      atual.map((i) =>
        i.linha_id === linhaId
          ? { ...i, codigo_peca: codigoValido, preco_unitario: calcularPrecoUnitario(codigoValido, i.multiplicador) }
          : i,
      ),
    );
  }

  function removerItem(linhaId: string) {
    setCarrinho((atual) => atual.filter((i) => i.linha_id !== linhaId));
  }

  function cancelarVenda() {
    if (!confirm("Cancelar essa venda e descartar o rascunho salvo?")) return;
    setErro(null);
    limparFormulario();
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
          percentualDesconto: percentualDesconto ? parseMoeda(percentualDesconto) : null,
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
        {avisoPopupBloqueado && (
          <p className="max-w-xs text-xs text-warn">
            O navegador bloqueou a abertura automática do cupom. Clique no botão abaixo pra imprimir — e permita
            pop-ups deste site pra abrir sozinho da próxima vez.
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={`/pedidos/${pedidoCriado.id}/cupom`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink"
          >
            🧾 Imprimir cupom (58mm)
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
            onClick={() => {
              setPedidoCriado(null);
              setAvisoPopupBloqueado(false);
            }}
            className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
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
    <div className="flex flex-col gap-5 p-4 sm:gap-3 sm:p-4">
      {(carrinho.length > 0 || clienteSelecionado) && (
        <div className="flex items-center justify-between rounded-lg bg-cream px-3 py-2 text-xs text-text-soft">
          <span>Venda em andamento salva automaticamente — pode sair e voltar sem perder nada.</span>
          <button
            type="button"
            onClick={cancelarVenda}
            className="shrink-0 font-semibold text-rose-deep hover:underline"
          >
            Cancelar venda
          </button>
        </div>
      )}

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
                onChange={(e) => {
                  setBuscaCliente(e.target.value);
                  setIndiceClienteAtivo(0);
                }}
                onKeyDown={aoNavegarLista(clientesFiltrados, indiceClienteClampado, setIndiceClienteAtivo, selecionarCliente)}
                placeholder="Buscar cliente por nome, telefone ou documento"
                className="w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft sm:px-2.5 sm:py-1.5"
              />
              <button
                type="button"
                onClick={() => setNovoClienteAberto(true)}
                className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-rose-deep sm:px-2.5 sm:py-1.5"
              >
                + Novo
              </button>
            </div>
            {clientesFiltrados.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border-2 border-rose-soft bg-cream shadow-lg">
                {clientesFiltrados.map((c, i) => (
                  <li key={c.id} ref={(el) => {
                    if (i === indiceClienteClampado) el?.scrollIntoView({ block: "nearest" });
                  }}>
                    <button
                      type="button"
                      onClick={() => selecionarCliente(c)}
                      onMouseEnter={() => setIndiceClienteAtivo(i)}
                      className={`block w-full border-l-[3px] px-3 py-2 text-left text-sm sm:px-2.5 sm:py-1 ${
                        i === indiceClienteClampado
                          ? "border-rose-deep bg-rose-soft font-medium text-rose-deep"
                          : "border-transparent hover:bg-rose-soft/40"
                      }`}
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
            onChange={(e) => {
              setBuscaProduto(e.target.value);
              setIndiceProdutoAtivo(0);
            }}
            onKeyDown={aoNavegarLista(produtosFiltrados, indiceProdutoClampado, setIndiceProdutoAtivo, adicionarProduto)}
            placeholder="Buscar por nome, categoria ou código interno"
            className="w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft sm:px-2.5 sm:py-1.5"
          />
          {produtosFiltrados.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border-2 border-rose-soft bg-cream shadow-lg">
              {produtosFiltrados.map((p, i) => (
                <li key={p.id} ref={(el) => {
                    if (i === indiceProdutoClampado) el?.scrollIntoView({ block: "nearest" });
                  }}>
                  <button
                    type="button"
                    onClick={() => adicionarProduto(p)}
                    onMouseEnter={() => setIndiceProdutoAtivo(i)}
                    className={`flex w-full items-center justify-between border-l-[3px] px-3 py-2 text-left text-sm sm:px-2.5 sm:py-1 ${
                      i === indiceProdutoClampado
                        ? "border-rose-deep bg-rose-soft font-medium text-rose-deep"
                        : "border-transparent hover:bg-rose-soft/40"
                    }`}
                  >
                    <span>
                      {p.codigo_interno && <span className="text-text-soft">#{p.codigo_interno} · </span>}
                      {p.nome}
                    </span>
                    <span className={p.quantidade_estoque <= 0 ? "font-semibold text-warn" : "text-text-soft"}>
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
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5">Cód. interno</th>
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5">Descrição</th>
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5">Qtd.</th>
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5">Ref.</th>
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5">Unit.</th>
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5">Total</th>
              <th className="px-3 py-2 sm:px-2.5 sm:py-1.5" />
            </tr>
          </thead>
          <tbody>
            {carrinho.map((i) => (
              <tr key={i.linha_id} className="border-t border-line">
                <td className="px-3 py-2 text-text-soft tabular-nums sm:px-2.5 sm:py-1">
                  {produtosPorId.get(i.produto_id)?.codigo_interno ?? "—"}
                </td>
                <td className="px-3 py-2 sm:px-2.5 sm:py-1">{i.nome}</td>
                <td className="px-3 py-2 sm:px-2.5 sm:py-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={edicaoQuantidade[i.linha_id] ?? String(i.quantidade)}
                    onChange={(e) => {
                      const texto = e.target.value;
                      setEdicaoQuantidade((atual) => ({ ...atual, [i.linha_id]: texto }));
                      const numero = Number(texto);
                      if (texto.trim() !== "" && Number.isFinite(numero)) alterarQuantidade(i.linha_id, numero);
                    }}
                    onBlur={() =>
                      setEdicaoQuantidade((atual) => {
                        const copia = { ...atual };
                        delete copia[i.linha_id];
                        return copia;
                      })
                    }
                    className="w-16 rounded border border-line bg-cream px-2 py-1 text-sm sm:py-0.5"
                  />
                </td>
                <td className="px-3 py-2 sm:px-2.5 sm:py-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={edicaoCodigo[i.linha_id] ?? String(i.codigo_peca ?? 0)}
                    onChange={(e) => {
                      const texto = e.target.value;
                      setEdicaoCodigo((atual) => ({ ...atual, [i.linha_id]: texto }));
                      // Código da peça aceita vírgula decimal (convenção
                      // brasileira, mesmo tratamento de `parseMoeda`).
                      const numero = Number(texto.replace(",", "."));
                      if (texto.trim() !== "" && Number.isFinite(numero)) alterarCodigoPeca(i.linha_id, numero);
                    }}
                    onBlur={() =>
                      setEdicaoCodigo((atual) => {
                        const copia = { ...atual };
                        delete copia[i.linha_id];
                        return copia;
                      })
                    }
                    title={`Ref. × ${i.multiplicador} = valor unitário`}
                    className="w-20 rounded border border-line bg-cream px-2 py-1 text-sm sm:py-0.5"
                  />
                </td>
                <td className="px-3 py-2 tabular-nums sm:px-2.5 sm:py-1">{formatarMoeda(i.preco_unitario)}</td>
                <td className="px-3 py-2 tabular-nums sm:px-2.5 sm:py-1">
                  {formatarMoeda(i.quantidade * i.preco_unitario)}
                </td>
                <td className="px-1 py-2 text-right sm:py-1">
                  <button
                    type="button"
                    onClick={() => removerItem(i.linha_id)}
                    className="-m-2 rounded-full p-2 text-text-soft hover:bg-crit-bg hover:text-crit"
                    aria-label={`Remover ${i.nome}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {carrinho.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-text-soft">
                  Nenhum produto adicionado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-line bg-cream p-4 sm:p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-text-soft sm:mb-2">
          Desconto / acréscimo
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-2">
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
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Desconto (R$)</label>
            <input
              value={valorDesconto}
              onChange={(e) => setValorDesconto(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
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
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.7rem] text-text-soft">Acréscimo (R$)</label>
            <input
              value={valorAcrescimo}
              onChange={(e) => setValorAcrescimo(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-cream p-4 sm:p-3">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-text-soft sm:mb-2">
          Forma de pagamento
        </p>
        <div className="flex flex-wrap gap-2 sm:gap-1.5">
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
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold sm:px-2.5 sm:py-1 ${
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
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
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
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
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
                    className="-m-2 rounded-full p-2 text-text-soft hover:bg-crit-bg hover:text-crit"
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

            {temPromissoriaEmMisto && (
              <div className="mt-1 flex flex-col gap-3 rounded-lg border border-line bg-cream p-3">
                <p className="text-[0.7rem] text-text-soft">
                  A perna de {formatarMoeda(valorPromissoriaMisto)} em promissória vira conta a receber — as outras
                  formas já foram recebidas na hora.
                </p>
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
                      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm sm:py-1"
                    />
                  </div>
                </div>
                <ul className="text-sm text-text-soft">
                  {Array.from({ length: numeroParcelas }, (_, i) => (
                    <li key={i}>
                      Parcela {i + 1}/{numeroParcelas} — vence {formatarDataIso(somaMeses(primeiroVencimento, i))} —{" "}
                      <span className="font-semibold text-ink">
                        {formatarMoeda(valorPromissoriaMisto / numeroParcelas)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

      {itensAcimaDoEstoque.length > 0 && (
        <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs font-medium text-warn">
          Estoque ficará negativo para: {itensAcimaDoEstoque.map((i) => `${i.nome} (${i.estoqueDisponivel} em estoque)`).join(", ")}.
        </p>
      )}

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

      {/* Fixo no rodapé só no mobile (sm:static desfaz tudo em telas maiores)
          — numa venda real, os botões de fechar a venda ficavam depois de
          busca de cliente/produto, carrinho, desconto e forma de pagamento;
          pra tocar em "Finalizar" era preciso rolar a página inteira até o
          fim toda vez. `-mx-4`/`px-4` cancela e reaplica exatamente o
          `p-4` do container raiz (não mexe no padding do app-shell por
          fora), então os botões continuam alinhados com o resto da página,
          só a barra em si passa a acompanhar o fim da tela. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-line bg-surface px-4 py-3 sm:static sm:z-auto sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
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
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
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
