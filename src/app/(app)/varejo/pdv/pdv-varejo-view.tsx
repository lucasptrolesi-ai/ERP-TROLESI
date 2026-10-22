"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { arredondarMoeda, lerMoeda } from "@/lib/dinheiro";
import { filtra } from "@/lib/filtra";
import { formatarDataIso } from "@/lib/datas";
import { cancelarVenda, registrarVenda } from "@/lib/actions/varejo";
import { calcularLinha, calcularTotais, calcularTroco, type ItemCarrinho } from "@/lib/varejo/carrinho";
import { calcularDescontoCupomVarejo } from "@/lib/varejo/cupom";
import { espacoParaCashback, valorCashbackAConceder } from "@/lib/varejo/cashback";
import { buscarCashbackDisponivel } from "@/lib/actions/cashback-varejo";
import { Modal } from "@/components/modal";
import { PinSupervisorModal } from "@/components/pin-supervisor-modal";
import { ClientePickerPdv } from "@/components/cliente-picker-pdv";
import type { ClienteResumoVarejo } from "@/lib/actions/clientes-varejo";
import type {
  CashbackDisponivel,
  CupomVarejo,
  FormaPagamento,
  ItemCatalogo,
  PagamentoDaVenda,
  SessaoCaixa,
  Supervisor,
  VendaDaSessao,
} from "@/lib/varejo/tipos";

const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Crédito" },
];

export function PdvVarejoView({
  sessao,
  catalogo,
  supervisores,
  vendas,
  cupons,
}: {
  sessao: SessaoCaixa | null;
  catalogo: ItemCatalogo[];
  supervisores: Supervisor[];
  vendas: VendaDaSessao[];
  cupons: CupomVarejo[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [forma, setForma] = useState<FormaPagamento>("dinheiro");
  const [valorRecebidoTexto, setValorRecebidoTexto] = useState("");
  const [clienteNomeLivre, setClienteNomeLivre] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteResumoVarejo | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pinAberto, setPinAberto] = useState(false);
  const [pinEstoqueAberto, setPinEstoqueAberto] = useState(false);
  const [autorizacaoDesconto, setAutorizacaoDesconto] = useState<string | null>(null);
  const [autorizacaoEstoque, setAutorizacaoEstoque] = useState<string | null>(null);
  const [percentualDesconto, setPercentualDesconto] = useState("");
  const [valorDescontoTexto, setValorDescontoTexto] = useState("0");
  const [cupomCodigo, setCupomCodigo] = useState("");
  const [cupomAplicado, setCupomAplicado] = useState<CupomVarejo | null>(null);
  const [erroCupom, setErroCupom] = useState<string | null>(null);
  const [percentualAcrescimo, setPercentualAcrescimo] = useState("");
  const [valorAcrescimoTexto, setValorAcrescimoTexto] = useState("0");
  const [cashbackDisponivel, setCashbackDisponivel] = useState<CashbackDisponivel[]>([]);
  const [cashbackAplicado, setCashbackAplicado] = useState<CashbackDisponivel | null>(null);
  const [concederCashback, setConcederCashback] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();
  const [, iniciarBuscaCashback] = useTransition();

  // Cashback (Fase 3, 2026-10-21): ao trocar de cliente, busca o cashback disponível dele e esquece
  // qualquer seleção anterior (de outro cliente) — "aponta automático", nunca aplica sozinho. Também
  // zera o "conceder cashback nesta venda" (achado de code review, 2026-10-21: sem isso, um toggle
  // marcado pensando no cliente A sobrevivia à troca pro cliente B e acabava concedendo pra B, sem
  // nenhum aviso visível do erro).
  // `cancelada` evita que uma busca mais lenta de um cliente ANTERIOR sobrescreva, depois de
  // resolvida fora de ordem, o cashback do cliente selecionado por último (achado de code review,
  // 2026-10-21: sem essa guarda, o vendedor podia ver/aplicar o cashback do cliente errado).
  useEffect(() => {
    let cancelada = false;
    iniciarBuscaCashback(async () => {
      setCashbackAplicado(null);
      setConcederCashback(false);
      if (!clienteSelecionado) {
        setCashbackDisponivel([]);
        return;
      }
      const lista = await buscarCashbackDisponivel(clienteSelecionado.id);
      if (!cancelada) setCashbackDisponivel(lista);
    });
    return () => {
      cancelada = true;
    };
  }, [clienteSelecionado]);

  const resultados = useMemo(() => {
    if (busca.trim().length < 1) return catalogo.slice(0, 24);
    return filtra(catalogo, busca, (i) => `${i.nome} ${i.sku} ${i.codigo_barras ?? ""}`).slice(0, 24);
  }, [catalogo, busca]);

  function adicionar(item: ItemCatalogo) {
    setCarrinho((atual) => {
      const existe = atual.find((l) => l.variacao.variacao_id === item.variacao_id);
      if (existe) {
        return atual.map((l) =>
          l.variacao.variacao_id === item.variacao_id ? { ...l, quantidade: l.quantidade + 1 } : l,
        );
      }
      return [...atual, { variacao: item, quantidade: 1, precoTexto: item.preco_venda.toFixed(2).replace(".", ",") }];
    });
    setAutorizacaoDesconto(null);
    setAutorizacaoEstoque(null);
  }

  function mudarQuantidade(variacaoId: string, delta: number) {
    setCarrinho((atual) =>
      atual
        .map((l) => (l.variacao.variacao_id === variacaoId ? { ...l, quantidade: l.quantidade + delta } : l))
        .filter((l) => l.quantidade > 0),
    );
    setAutorizacaoEstoque(null);
  }

  function mudarPreco(variacaoId: string, texto: string) {
    setCarrinho((atual) => atual.map((l) => (l.variacao.variacao_id === variacaoId ? { ...l, precoTexto: texto } : l)));
    setAutorizacaoDesconto(null);
  }

  // Matematica do carrinho (preco travado no maximo de tabela, piso, subtotal/total, troco) em
  // src/lib/varejo/carrinho.ts, testada isoladamente — nao repetida aqui.
  const linhas = carrinho.map(calcularLinha);
  const { subtotal, total: totalItens, precisaAutorizacao, precisaAutorizacaoEstoque } = calcularTotais(linhas);
  // Desconto/acréscimo do carrinho inteiro (pedido do usuário, 2026-09-30) — livre, sem PIN,
  // separado da autorização de preço abaixo do mínimo por peça acima (essa continua olhando só o
  // preço de cada item). Mesmo padrão do PDV Atacado: o % só calcula o R$, que é o valor real.
  // Cupom (Fase 2, 2026-10-20) sempre recalcula em cima do total de itens atual (se o carrinho mudar
  // depois de aplicar, o desconto acompanha) — só cai pro campo manual quando não há cupom ativo,
  // mesmo espírito do PDV Eventos (ver vender-evento.tsx). Cashback resgatado (Fase 3, 2026-10-21) é
  // dinheiro do próprio cliente, não uma promoção — soma ao desconto do cupom/manual em vez de
  // substituir (as duas coisas podem coexistir na mesma venda).
  const numDescontoCarrinho = cupomAplicado
    ? calcularDescontoCupomVarejo(cupomAplicado.tipo, cupomAplicado.valor, totalItens)
    : (lerMoeda(valorDescontoTexto) ?? 0);
  const numAcrescimo = lerMoeda(valorAcrescimoTexto) ?? 0;
  // O cashback é resgatado inteiro (a tabela não guarda "uso parcial" -- um lançamento vira
  // 'disponivel' ou 'usado', nunca fica com saldo residual): deixar aplicar mesmo sem caber no
  // carrinho faria a venda rejeitar no registrar_venda ('total não pode ficar negativo') OU, se
  // capasse só o desconto aqui, queimaria o cashback inteiro descontando só uma parte -- o cliente
  // perderia a diferença. Por isso o botão "Usar" só aparece pro PRIMEIRO cashback (ordenado por
  // vencimento) que couber (cashbackUsavel) — não necessariamente o [0] da lista, senão um cliente
  // com dois créditos (um grande que não cabe, um menor que cabe) nunca conseguia usar o menor
  // (achado de code review, 2026-10-21) — e, se o carrinho encolher DEPOIS de aplicado (item
  // removido, cupom trocado), cashbackAplicadoValido reavalia a cada render e some do total sem
  // deixar a venda chegar no servidor com um desconto maior que o carrinho.
  const espacoCashback = espacoParaCashback(totalItens, numDescontoCarrinho, numAcrescimo);
  const cashbackAplicadoValido = cashbackAplicado ? cashbackAplicado.valor <= espacoCashback : true;
  const numCashbackUsado = cashbackAplicado && cashbackAplicadoValido ? cashbackAplicado.valor : 0;
  const numDesconto = numDescontoCarrinho + numCashbackUsado;
  const cashbackUsavel = cashbackDisponivel.find((c) => c.valor <= espacoCashback) ?? null;
  const total = Math.max(0, arredondarMoeda(totalItens - numDesconto + numAcrescimo));
  const valorRecebido = lerMoeda(valorRecebidoTexto) ?? 0;
  const troco = calcularTroco(forma, valorRecebido, total);

  function aplicarCupom() {
    const codigo = cupomCodigo.trim();
    if (!codigo) return;
    const encontrado = cupons.find((c) => c.codigo.trim().toLowerCase() === codigo.toLowerCase());
    if (!encontrado) {
      setErroCupom("Cupom não encontrado.");
      return;
    }
    if (!encontrado.ativo) {
      setErroCupom("Esse cupom está desativado.");
      return;
    }
    setErroCupom(null);
    setCupomAplicado(encontrado);
  }

  function removerCupom() {
    setCupomAplicado(null);
    setCupomCodigo("");
    setErroCupom(null);
  }

  function limparVenda() {
    setCarrinho([]);
    setValorRecebidoTexto("");
    setClienteNomeLivre("");
    setClienteSelecionado(null);
    setAutorizacaoDesconto(null);
    setAutorizacaoEstoque(null);
    setPercentualDesconto("");
    setValorDescontoTexto("0");
    removerCupom();
    setPercentualAcrescimo("");
    setValorAcrescimoTexto("0");
    setCashbackAplicado(null);
    setConcederCashback(false);
    setIdempotencyKey(crypto.randomUUID());
  }

  function finalizar() {
    setErro(null);
    if (carrinho.length === 0) {
      setErro("Adicione ao menos um item.");
      return;
    }
    if (precisaAutorizacao && !autorizacaoDesconto) {
      setErro("Há item abaixo do preço mínimo: autorize com o supervisor antes de finalizar.");
      return;
    }
    if (precisaAutorizacaoEstoque && !autorizacaoEstoque) {
      setErro("Há item com saldo insuficiente: autorize com o supervisor antes de finalizar.");
      return;
    }
    if (forma === "dinheiro" && valorRecebido < total) {
      setErro("O valor recebido é menor que o total.");
      return;
    }
    if (cashbackAplicado && !cashbackAplicadoValido) {
      setErro("O carrinho diminuiu e o cashback aplicado não cabe mais — remova-o ou aumente o carrinho.");
      return;
    }
    // registrar_venda sempre exige ao menos um pagamento com valor MAIOR que zero (não aceita uma
    // forma de pagamento com R$0) — uma venda que fecha em R$0 (ex: cashback cobrindo o total
    // inteiro) não tem como ser registrada hoje. Bloqueia aqui com uma mensagem clara em vez de deixar
    // estourar um erro genérico do servidor (achado de code review, 2026-10-21).
    if (total <= 0) {
      setErro("O total ficaria zerado (cashback cobre tudo) — reduza o cashback usado ou adicione mais itens.");
      return;
    }
    const pagamentos: PagamentoDaVenda[] =
      forma === "dinheiro" ? [{ forma, valor: valorRecebido }] : [{ forma, valor: total }];

    iniciarEnvio(async () => {
      // Resgate/concessão de cashback viajam JUNTO com a venda (mesmo registrarVenda, que por baixo
      // chama a função atômica registrar_venda_varejo_com_cashback) — se qualquer um dos dois falhar,
      // a venda inteira também não é criada. Nenhuma chamada separada depois: evita a janela onde a
      // venda saía com o desconto aplicado mas o cashback continuava disponível pra usar de novo
      // (achado de code review, 2026-10-21 — ver DECISIONS.md).
      const resultado = await registrarVenda({
        sessaoId: sessao!.sessao_id,
        itens: linhas.map((l) => ({ variacao_id: l.variacao.variacao_id, quantidade: l.quantidade, preco_unitario: l.preco })),
        pagamentos,
        idempotencyKey,
        clienteId: clienteSelecionado?.id,
        clienteNome: clienteSelecionado?.nome ?? (clienteNomeLivre || undefined),
        autorizacaoDescontoId: autorizacaoDesconto ?? undefined,
        autorizacaoEstoqueId: autorizacaoEstoque ?? undefined,
        valorDesconto: numDesconto || undefined,
        valorAcrescimo: numAcrescimo || undefined,
        cashbackResgatarId: cashbackAplicado?.id,
        concederCashback,
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }

      const trocoTexto = forma === "dinheiro" && troco > 0 ? ` — troco: ${formatarMoeda(troco)}` : "";
      setSucesso(`Venda registrada${trocoTexto}.`);
      limparVenda();
      router.refresh();
    });
  }

  if (!sessao) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        <p className="mb-3">Nenhum caixa aberto para você agora.</p>
        <Link href="/varejo/caixa" className="font-semibold text-rose-deep underline decoration-dotted">
          Abrir caixa
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, SKU ou código de barras"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {resultados.map((item) => (
            <button
              key={item.variacao_id}
              type="button"
              onClick={() => adicionar(item)}
              className="rounded-lg border border-line p-2.5 text-left text-sm"
            >
              <p className="font-semibold">{item.nome}</p>
              <p className="text-xs text-text-soft">{Object.values(item.atributos ?? {}).join(" · ") || item.sku}</p>
              <p className={`mt-1 ${item.saldo <= 0 ? "text-red-700" : ""}`}>
                {formatarMoeda(item.preco_venda)} · {item.saldo > 0 ? `${item.saldo} un` : "sem saldo — precisa autorização"}
              </p>
            </button>
          ))}
          {resultados.length === 0 && <p className="col-span-full text-sm text-text-soft">Nada encontrado.</p>}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-2 border-b border-line pb-3">
          {linhas.length === 0 && <p className="text-sm text-text-soft">Carrinho vazio.</p>}
          {linhas.map((l) => (
            <div key={l.variacao.variacao_id} className="flex flex-col gap-1 border-b border-line pb-2 last:border-0">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{l.variacao.nome}</span>
                <span>{formatarMoeda(l.preco * l.quantidade)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-soft">
                <button type="button" onClick={() => mudarQuantidade(l.variacao.variacao_id, -1)} className="h-7 w-7 rounded-full border border-line">
                  −
                </button>
                <span className="min-w-[1.5rem] text-center">{l.quantidade}</span>
                <button type="button" onClick={() => mudarQuantidade(l.variacao.variacao_id, 1)} className="h-7 w-7 rounded-full border border-line">
                  +
                </button>
                <span className="ml-auto">preço</span>
                <input
                  type="text"
                  value={l.precoTexto}
                  onChange={(e) => mudarPreco(l.variacao.variacao_id, e.target.value)}
                  className={`w-20 rounded border px-2 py-1 ${l.abaixoDoPiso ? "border-red-400 text-red-700" : "border-line"}`}
                />
              </div>
              {l.abaixoDoPiso && <p className="text-xs text-red-700">Abaixo do preço mínimo — precisa de autorização.</p>}
              {l.saldoInsuficiente && <p className="text-xs text-red-700">Saldo insuficiente ({l.variacao.saldo} em estoque) — precisa de autorização.</p>}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between text-text-soft">
            <span>Subtotal</span>
            <span>{formatarMoeda(subtotal)}</span>
          </div>
          <div className="flex justify-between text-text-soft">
            <span>Desconto</span>
            <span>{formatarMoeda(arredondarMoeda(subtotal - totalItens))}</span>
          </div>
          {numDescontoCarrinho > 0 && (
            <div className="flex justify-between text-text-soft">
              <span>Desconto do carrinho</span>
              <span className="tabular-nums">− {formatarMoeda(numDescontoCarrinho)}</span>
            </div>
          )}
          {numCashbackUsado > 0 && (
            <div className="flex justify-between text-text-soft">
              <span>Cashback usado</span>
              <span className="tabular-nums">− {formatarMoeda(numCashbackUsado)}</span>
            </div>
          )}
          {numAcrescimo > 0 && (
            <div className="flex justify-between text-text-soft">
              <span>Acréscimo do carrinho</span>
              <span className="tabular-nums">+ {formatarMoeda(numAcrescimo)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-semibold">
            <span>Total</span>
            <span>{formatarMoeda(total)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-cream p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-soft">Cupom de desconto</p>
          {cupomAplicado ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-mono font-semibold">{cupomAplicado.codigo}</span>{" "}
                <span className="text-text-soft">
                  ({cupomAplicado.tipo === "percentual" ? `${cupomAplicado.valor}%` : formatarMoeda(cupomAplicado.valor)})
                </span>
              </span>
              <button type="button" onClick={removerCupom} className="text-xs font-semibold text-rose-deep underline decoration-dotted">
                Remover
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={cupomCodigo}
                onChange={(e) => setCupomCodigo(e.target.value)}
                placeholder="Código do cupom"
                className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={aplicarCupom}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-rose-deep"
              >
                Aplicar
              </button>
            </div>
          )}
          {erroCupom && <p className="mt-1 text-xs font-medium text-red-700">{erroCupom}</p>}
        </div>

        {clienteSelecionado && (cashbackDisponivel.length > 0 || cashbackAplicado) && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              cashbackAplicado && !cashbackAplicadoValido
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-900"
            }`}
          >
            {cashbackAplicado ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  {cashbackAplicadoValido ? (
                    <>
                      Cashback aplicado: <span className="font-semibold">{formatarMoeda(cashbackAplicado.valor)}</span>
                    </>
                  ) : (
                    <>
                      Cashback de <span className="font-semibold">{formatarMoeda(cashbackAplicado.valor)}</span> não cabe mais no
                      carrinho — remova ou aumente o carrinho.
                    </>
                  )}
                </span>
                <button type="button" onClick={() => setCashbackAplicado(null)} className="text-xs font-semibold underline decoration-dotted">
                  Remover
                </button>
              </div>
            ) : cashbackUsavel ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  💰 Cliente tem <span className="font-semibold">{formatarMoeda(cashbackUsavel.valor)}</span> de cashback
                  disponível (vence {formatarDataIso(cashbackUsavel.vencimento)})
                </span>
                <button
                  type="button"
                  onClick={() => setCashbackAplicado(cashbackUsavel)}
                  className="text-xs font-semibold underline decoration-dotted"
                >
                  Usar
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span>
                  💰 Cliente tem <span className="font-semibold">{formatarMoeda(cashbackDisponivel[0].valor)}</span> de cashback
                  disponível (vence {formatarDataIso(cashbackDisponivel[0].vencimento)}) — carrinho menor que o saldo, aumente
                  pra poder usar
                </span>
              </div>
            )}
          </div>
        )}

        {clienteSelecionado && (
          <div className="rounded-lg border border-line bg-cream p-3">
            {/* Concessão deixou de ser livre (pedido do usuário, 2026-10-22): sempre 10% do total
                pago, vencimento sempre em 30 dias — o vendedor só decide SE concede, não quanto. O
                preview aqui é só pra tela; o valor de verdade é recalculado no banco a partir de
                vendas.total já persistido (fonte real, não confia em nada vindo do cliente). */}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={concederCashback} onChange={(e) => setConcederCashback(e.target.checked)} />
              Conceder cashback desta venda ({formatarMoeda(valorCashbackAConceder(total))}, vence em 30 dias)
            </label>
          </div>
        )}

        <div className="rounded-lg border border-line bg-cream p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-soft">Desconto / acréscimo do carrinho</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {!cupomAplicado && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[0.7rem] text-text-soft">Desconto (%)</span>
                  <input
                    value={percentualDesconto}
                    onChange={(e) => {
                      setPercentualDesconto(e.target.value);
                      const p = Number(e.target.value.replace(",", "."));
                      if (Number.isFinite(p)) setValorDescontoTexto(((totalItens * p) / 100).toFixed(2));
                    }}
                    placeholder="0"
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[0.7rem] text-text-soft">Desconto (R$)</span>
                  <input
                    value={valorDescontoTexto}
                    onChange={(e) => setValorDescontoTexto(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[0.7rem] text-text-soft">Acréscimo (%)</span>
              <input
                value={percentualAcrescimo}
                onChange={(e) => {
                  setPercentualAcrescimo(e.target.value);
                  const p = Number(e.target.value.replace(",", "."));
                  if (Number.isFinite(p)) setValorAcrescimoTexto(((totalItens * p) / 100).toFixed(2));
                }}
                placeholder="0"
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.7rem] text-text-soft">Acréscimo (R$)</span>
              <input
                value={valorAcrescimoTexto}
                onChange={(e) => setValorAcrescimoTexto(e.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        </div>

        <ClientePickerPdv
          clienteSelecionado={clienteSelecionado}
          onSelecionar={setClienteSelecionado}
          nomeLivre={clienteNomeLivre}
          onMudarNomeLivre={setClienteNomeLivre}
        />

        <div className="grid grid-cols-4 gap-1.5">
          {FORMAS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setForma(f.valor)}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                forma === f.valor ? "border-rose bg-rose-soft text-rose-deep" : "border-line text-text-soft"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        {forma === "dinheiro" && (
          <label className="flex flex-col gap-1 text-sm">
            Valor recebido
            <input
              type="text"
              value={valorRecebidoTexto}
              onChange={(e) => setValorRecebidoTexto(e.target.value)}
              placeholder={formatarMoeda(total)}
              className="rounded-lg border border-line bg-surface px-3 py-2"
            />
            {troco > 0 && <span className="text-xs text-text-soft">Troco: {formatarMoeda(troco)}</span>}
          </label>
        )}

        {precisaAutorizacao && (
          <button
            type="button"
            onClick={() => setPinAberto(true)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              autorizacaoDesconto ? "border-line text-text-soft" : "border-red-400 text-red-700"
            }`}
          >
            {autorizacaoDesconto ? "Desconto autorizado" : "Autorizar desconto abaixo do mínimo"}
          </button>
        )}

        {precisaAutorizacaoEstoque && (
          <button
            type="button"
            onClick={() => setPinEstoqueAberto(true)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              autorizacaoEstoque ? "border-line text-text-soft" : "border-red-400 text-red-700"
            }`}
          >
            {autorizacaoEstoque ? "Estoque negativo autorizado" : "Autorizar venda com saldo insuficiente"}
          </button>
        )}

        {erro && <p className="text-sm text-red-700">{erro}</p>}
        {sucesso && <p className="text-sm text-emerald-700">{sucesso}</p>}

        <button
          type="button"
          onClick={finalizar}
          disabled={enviando || linhas.length === 0}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2.5 font-semibold text-gold-ink disabled:opacity-60"
        >
          {enviando ? "Finalizando…" : "Finalizar venda"}
        </button>
      </div>

      <VendasDaSessao vendas={vendas} supervisores={supervisores} onCancelada={() => router.refresh()} />

      <PinSupervisorModal
        aberto={pinAberto}
        onFechar={() => setPinAberto(false)}
        acao="desconto_abaixo_piso"
        alvoId={sessao.sessao_id}
        supervisores={supervisores}
        onAutorizado={(id) => {
          setAutorizacaoDesconto(id);
          setPinAberto(false);
        }}
      />

      <PinSupervisorModal
        aberto={pinEstoqueAberto}
        onFechar={() => setPinEstoqueAberto(false)}
        acao="estoque_negativo"
        alvoId={sessao.sessao_id}
        supervisores={supervisores}
        onAutorizado={(id) => {
          setAutorizacaoEstoque(id);
          setPinEstoqueAberto(false);
        }}
      />
    </div>
  );
}

/**
 * Vendas da sessão aberta, com cancelamento — exige PIN de supervisor (autorização pontual, uso
 * único) e um motivo. Sem esta tela, cancelar_venda (no banco) ficava sem nenhuma forma de acesso
 * pela UI (achado no code review, 2026-09-22).
 */
function VendasDaSessao({
  vendas,
  supervisores,
  onCancelada,
}: {
  vendas: VendaDaSessao[];
  supervisores: Supervisor[];
  onCancelada: () => void;
}) {
  const [vendaAlvo, setVendaAlvo] = useState<VendaDaSessao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pinAberto, setPinAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  if (vendas.length === 0) return null;

  function fechar() {
    setVendaAlvo(null);
    setMotivo("");
    setErro(null);
  }

  function pedirAutorizacao() {
    if (!motivo.trim()) {
      setErro("Informe o motivo do cancelamento.");
      return;
    }
    setErro(null);
    setPinAberto(true);
  }

  function confirmarCancelamento(autorizacaoId: string) {
    setPinAberto(false);
    const venda = vendaAlvo;
    if (!venda) return;
    iniciar(async () => {
      const resposta = await cancelarVenda(venda.id, motivo, autorizacaoId);
      if (resposta.erro) {
        setErro(resposta.erro);
        setVendaAlvo(venda);
        return;
      }
      fechar();
      onCancelada();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-4 shadow-sm lg:col-span-2 sm:p-5">
      <p className="text-sm font-semibold">Vendas desta sessão</p>
      <div className="flex flex-col gap-1.5">
        {vendas.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 text-sm last:border-0">
            <span>
              #{v.numero} · {formatarMoeda(v.total)}
              {v.status === "cancelada" && <span className="ml-2 text-xs text-text-soft">cancelada</span>}
            </span>
            {v.status === "concluida" && (
              <button
                type="button"
                onClick={() => setVendaAlvo(v)}
                className="text-xs font-semibold text-red-700 underline decoration-dotted"
              >
                Cancelar
              </button>
            )}
          </div>
        ))}
      </div>

      {vendaAlvo && (
        <Modal aberto onFechar={fechar} titulo={`Cancelar venda #${vendaAlvo.numero}`}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-soft">
              O estoque volta pelo custo original da venda e, se houve dinheiro, o valor é estornado no caixa. Exige
              autorização de supervisor.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Motivo
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2"
              />
            </label>
            {erro && <p className="text-sm text-red-700">{erro}</p>}
            <button
              type="button"
              onClick={pedirAutorizacao}
              disabled={pendente}
              className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
            >
              {pendente ? "Cancelando…" : "Autorizar e cancelar"}
            </button>
          </div>
        </Modal>
      )}

      <PinSupervisorModal
        aberto={pinAberto}
        onFechar={() => setPinAberto(false)}
        acao="cancelamento_venda"
        alvoId={vendaAlvo?.id ?? null}
        supervisores={supervisores}
        onAutorizado={confirmarCancelamento}
      />
    </div>
  );
}
