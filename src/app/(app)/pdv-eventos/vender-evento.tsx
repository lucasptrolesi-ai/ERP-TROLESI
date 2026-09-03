"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { parseMoeda } from "@/lib/parse-moeda";
import { filtra } from "@/lib/filtra";
import { registrarVendaEvento } from "@/lib/actions/pdv-eventos";
import { FORMA_LABEL_EVENTO, FORMAS_PAGAMENTO_EVENTO } from "@/lib/forma-pagamento-evento";
import { calcularDescontoCupom } from "@/lib/cupom-evento";
import { calcularDescontoBerloques } from "@/lib/promocao-berloques";
import { CupomEventoView } from "./cupom-evento-view";
import { LeitorCameraModal } from "@/components/leitor-camera-modal";
import { FotoComZoom } from "@/components/foto-com-zoom";
import type { VendaEventoParaCupom } from "@/lib/cupom-linhas-evento";
import type { CupomEvento, FormaPagamentoEvento, ItemCarrinhoEvento, ProdutoEvento } from "@/lib/types";

export function VenderEvento({
  produtosEvento,
  cupons,
}: {
  produtosEvento: ProdutoEvento[];
  cupons: CupomEvento[];
}) {
  const [carrinho, setCarrinho] = useState<ItemCarrinhoEvento[]>([]);
  const [buscaCodigo, setBuscaCodigo] = useState("");
  const [codigoNaoEncontrado, setCodigoNaoEncontrado] = useState(false);
  const [leitorCameraAberto, setLeitorCameraAberto] = useState(false);
  const [valorDesconto, setValorDesconto] = useState("0");
  const [cupomCodigo, setCupomCodigo] = useState("");
  const [cupomAplicado, setCupomAplicado] = useState<CupomEvento | null>(null);
  const [erroCupom, setErroCupom] = useState<string | null>(null);
  const [clienteNome, setClienteNome] = useState("");
  const [clienteCpf, setClienteCpf] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamentoEvento>("dinheiro");
  const [numeroParcelas, setNumeroParcelas] = useState(2);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();
  const [vendaFinalizada, setVendaFinalizada] = useState<VendaEventoParaCupom | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const produtosPorCodigo = useMemo(() => {
    const mapa = new Map<string, ProdutoEvento>();
    // Só peças ativas — "Peça ativa" no cadastro (produto-evento-form.tsx)
    // precisa realmente tirar o item da venda, não só escondê-lo com opacity
    // na aba Estoque (achado de code review, 2026-08-13).
    for (const p of produtosEvento) {
      if (!p.ativo) continue;
      mapa.set(p.codigo_interno.trim().toLowerCase(), p);
    }
    return mapa;
  }, [produtosEvento]);

  // Busca por nome/descrição além do código — nem sempre o leitor está à
  // mão, ou a peça não tem código de barras físico (pedido do usuário,
  // 2026-08-31). Mesmo helper de busca já usado no resto do sistema; só
  // aparece com pelo menos 2 caracteres pra não listar tudo à toa, e não
  // atrapalha o bipe do leitor USB (que dispara pelo Enter, independente
  // da lista estar aberta ou não).
  const sugestoes = useMemo(() => {
    const termo = buscaCodigo.trim();
    if (termo.length < 2) return [];
    const ativos = produtosEvento.filter((p) => p.ativo);
    return filtra(ativos, termo, (p) => p.codigo_interno).slice(0, 8);
  }, [produtosEvento, buscaCodigo]);

  function selecionarSugestao(produto: ProdutoEvento) {
    adicionarAoCarrinho(produto);
    setBuscaCodigo("");
    setCodigoNaoEncontrado(false);
    inputRef.current?.focus();
  }

  const subtotal = carrinho.reduce((soma, i) => soma + i.quantidade * i.preco_unitario, 0);
  // Promoção berloques (pedido do usuário, 2026-09-03): 3+ peças com
  // código "BL" (qualquer combinação) saem por R$49,90 cada — automática,
  // não depende de cupom nem de desconto manual.
  const descontoBerloques = calcularDescontoBerloques(carrinho);
  // Cupom aplicado sempre recalcula em cima do subtotal atual (se o
  // carrinho mudar depois de aplicar, o desconto acompanha) — só cai pro
  // campo manual quando não há cupom ativo na venda.
  const descontoNum = cupomAplicado
    ? calcularDescontoCupom(cupomAplicado.tipo, cupomAplicado.valor, subtotal)
    : Math.max(0, parseMoeda(valorDesconto));
  // Valor "de tabela" — nunca muda por causa do ajuste manual, fica sempre
  // visível ao lado do valor final (pedido do usuário, 2026-09-03: "o valor
  // real da compra não pode ser alterado, aparece os dois").
  const totalCalculado = Math.max(0, subtotal - descontoNum - descontoBerloques);
  // Total final editável direto: "fechar em R$X" é mais natural numa
  // negociação de balcão do que reverter pra desconto em %/R$ — funciona
  // igual pra qualquer forma de pagamento, inclusive parcelado (a
  // quantidade de parcelas já usa este valor). null = segue o valor de
  // tabela; string = valor travado que o vendedor digitou, até limpar o
  // campo de novo.
  const [totalManual, setTotalManual] = useState<string | null>(null);
  const total = totalManual !== null ? Math.max(0, parseMoeda(totalManual)) : totalCalculado;
  // O banco só grava um total + um desconto (sem coluna própria pra "ajuste
  // de negociação") — esse é o desconto que de fato fecha a conta
  // registrada (subtotal − desconto = total), incluindo o ajuste manual se
  // houver. A linha "Desconto" na tela continua mostrando só o
  // cupom/desconto formal (descontoNum), sem misturar os dois.
  const descontoParaEnvio = Math.max(0, Math.round((subtotal - total) * 100) / 100);
  const itensAcimaDoEstoque = carrinho.filter((i) => i.quantidade > i.estoqueDisponivel);

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

  function adicionarAoCarrinho(produto: ProdutoEvento) {
    setCarrinho((atual) => {
      const existente = atual.find((i) => i.produto_evento_id === produto.id);
      if (existente) {
        return atual.map((i) =>
          i.produto_evento_id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i,
        );
      }
      return [
        ...atual,
        {
          linha_id: crypto.randomUUID(),
          produto_evento_id: produto.id,
          codigo_interno: produto.codigo_interno,
          nome: produto.nome,
          preco_unitario: produto.preco,
          quantidade: 1,
          estoqueDisponivel: produto.quantidade_estoque,
          fotoUrl: produto.foto_url,
        },
      ];
    });
  }

  // Compartilhada entre o leitor USB (bipagem por teclado) e o leitor por
  // câmera — os dois só precisam entregar o texto do código. Devolve a foto
  // também: é o que confirma visualmente, na hora da leitura, que a peça
  // escaneada é mesmo a que está sendo vendida.
  function processarCodigo(codigoBruto: string): { sucesso: boolean; nomeProduto?: string; fotoUrl?: string | null } {
    const codigo = codigoBruto.trim().toLowerCase();
    if (!codigo) return { sucesso: false };
    const produto = produtosPorCodigo.get(codigo);
    if (!produto) {
      setCodigoNaoEncontrado(true);
      return { sucesso: false };
    }
    setCodigoNaoEncontrado(false);
    adicionarAoCarrinho(produto);
    return { sucesso: true, nomeProduto: produto.nome, fotoUrl: produto.foto_url };
  }

  function handleKeyDownCodigo(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (processarCodigo(buscaCodigo).sucesso) {
      setBuscaCodigo("");
    }
  }

  function alterarQuantidade(linhaId: string, delta: number) {
    setCarrinho((atual) =>
      atual
        .map((i) => (i.linha_id === linhaId ? { ...i, quantidade: Math.max(0, i.quantidade + delta) } : i))
        .filter((i) => i.quantidade > 0),
    );
  }

  function removerLinha(linhaId: string) {
    setCarrinho((atual) => atual.filter((i) => i.linha_id !== linhaId));
  }

  function finalizarVenda() {
    if (carrinho.length === 0) {
      setErro("Adicione pelo menos uma peça à venda.");
      return;
    }
    setErro(null);
    iniciarEnvio(async () => {
      const resultado = await registrarVendaEvento(
        carrinho.map((i) => ({
          produto_evento_id: i.produto_evento_id,
          nome: i.nome,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario,
        })),
        formaPagamento,
        descontoParaEnvio,
        formaPagamento === "cartao_parcelado" ? numeroParcelas : 1,
        idempotencyKey,
        clienteNome.trim() || null,
        clienteCpf.trim() || null,
        clienteTelefone.trim() || null,
      );
      if (resultado.erro || !resultado.venda) {
        setErro(resultado.erro ?? "Não foi possível registrar a venda.");
        return;
      }
      setVendaFinalizada({
        numero: resultado.venda.numero,
        criado_em: resultado.venda.criado_em,
        forma_pagamento: formaPagamento,
        numero_parcelas: formaPagamento === "cartao_parcelado" ? numeroParcelas : 1,
        subtotal,
        valor_desconto: descontoParaEnvio,
        total,
        itens: carrinho.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
        cliente_nome: clienteNome.trim() || null,
        cliente_cpf: clienteCpf.trim() || null,
        cliente_telefone: clienteTelefone.trim() || null,
      });
      setCarrinho([]);
      setValorDesconto("0");
      setTotalManual(null);
      removerCupom();
      setFormaPagamento("dinheiro");
      setNumeroParcelas(2);
      setIdempotencyKey(crypto.randomUUID());
      setClienteNome("");
      setClienteCpf("");
      setClienteTelefone("");
    });
  }

  if (vendaFinalizada) {
    return <CupomEventoView venda={vendaFinalizada} onNovaVenda={() => setVendaFinalizada(null)} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <div className="flex items-center gap-2 rounded-xl border border-rose-deep bg-cream px-4 py-3">
            <span className="text-xl" aria-hidden>
              📷
            </span>
            <input
              ref={inputRef}
              autoFocus
              value={buscaCodigo}
              onChange={(e) => {
                setBuscaCodigo(e.target.value);
                setCodigoNaoEncontrado(false);
              }}
              onKeyDown={handleKeyDownCodigo}
              placeholder="Bipar código, ou digitar nome/código pra buscar"
              autoComplete="off"
              className="flex-1 border-none bg-transparent text-base text-ink outline-none"
            />
            <button
              type="button"
              onClick={() => setLeitorCameraAberto(true)}
              className="shrink-0 rounded-full bg-rose-soft px-3 py-1.5 text-xs font-semibold text-rose-deep"
            >
              📸 Câmera
            </button>
          </div>

          {sugestoes.length > 0 && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
              {sugestoes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selecionarSugestao(p)}
                  className="flex items-center gap-3 px-3 py-2.5 text-left hover:bg-cream"
                >
                  {p.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- foto vem do Storage, sem otimização
                    <img src={p.foto_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[0.55rem] text-text-soft">
                      sem foto
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-ink">{p.nome}</span>
                    <span className="text-xs text-text-soft">#{p.codigo_interno}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-rose-deep">{formatarMoeda(p.preco)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {codigoNaoEncontrado && (
          <p className="text-xs font-semibold text-crit">Código não encontrado no estoque do evento.</p>
        )}

        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="py-2 pl-4" />
                <th className="px-4 py-2">Peça</th>
                <th className="px-4 py-2 text-right">Qtd.</th>
                <th className="px-4 py-2 text-right">Unit.</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {carrinho.map((i) => (
                <tr key={i.linha_id} className="border-t border-line align-middle">
                  <td className="py-2 pl-4">
                    {i.fotoUrl ? (
                      <FotoComZoom src={i.fotoUrl} tamanhoBase="h-28 w-28" />
                    ) : (
                      <span className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-line text-[0.6rem] text-text-soft">
                        sem foto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-ink">{i.nome}</p>
                    {i.quantidade > i.estoqueDisponivel && (
                      <p className="text-[0.65rem] font-semibold text-crit">
                        Estoque do evento: {i.estoqueDisponivel} un.
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-line px-1 py-0.5">
                      <button
                        onClick={() => alterarQuantidade(i.linha_id, -1)}
                        className="h-5 w-5 rounded-full bg-rose-soft font-bold leading-none text-rose-deep"
                        aria-label="Diminuir"
                      >
                        −
                      </button>
                      <span className="w-5 text-center tabular-nums">{i.quantidade}</span>
                      <button
                        onClick={() => alterarQuantidade(i.linha_id, 1)}
                        className="h-5 w-5 rounded-full bg-rose-soft font-bold leading-none text-rose-deep"
                        aria-label="Aumentar"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatarMoeda(i.preco_unitario)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatarMoeda(i.quantidade * i.preco_unitario)}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button onClick={() => removerLinha(i.linha_id)} className="text-xs text-text-soft hover:text-crit">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {carrinho.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-soft">
                    Nenhuma peça no carrinho ainda — bipe o código pra começar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-semibold text-ink">Fechar venda</h2>

        <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-text-soft">Dados do cliente (opcional)</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-text-soft">Nome completo</span>
            <input
              value={clienteNome}
              onChange={(e) => setClienteNome(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-text-soft">CPF</span>
              <input
                value={clienteCpf}
                onChange={(e) => setClienteCpf(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-text-soft">Telefone</span>
              <input
                value={clienteTelefone}
                onChange={(e) => setClienteTelefone(e.target.value)}
                inputMode="tel"
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Cupom de desconto</span>
          {cupomAplicado ? (
            <div className="flex items-center justify-between rounded-lg border border-ok bg-ok-bg px-3 py-2 text-sm font-semibold text-ok">
              <span>
                {cupomAplicado.codigo} (
                {cupomAplicado.tipo === "percentual" ? `${cupomAplicado.valor}%` : formatarMoeda(cupomAplicado.valor)}
                )
              </span>
              <button type="button" onClick={removerCupom} className="text-xs underline">
                Remover
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={cupomCodigo}
                onChange={(e) => setCupomCodigo(e.target.value)}
                placeholder="Código do cupom"
                className="flex-1 rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
              <button
                type="button"
                onClick={aplicarCupom}
                className="rounded-lg border border-rose px-3 py-2 text-sm font-semibold text-rose-deep"
              >
                Aplicar
              </button>
            </div>
          )}
          {erroCupom && <p className="text-xs font-medium text-crit">{erroCupom}</p>}
        </div>

        {!cupomAplicado && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Desconto manual (R$)</span>
            <input
              value={valorDesconto}
              onChange={(e) => setValorDesconto(e.target.value)}
              inputMode="decimal"
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
          </label>
        )}

        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Forma de pagamento</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {FORMAS_PAGAMENTO_EVENTO.map((forma) => (
              <button
                key={forma}
                onClick={() => setFormaPagamento(forma)}
                className={`rounded-lg border px-2 py-2.5 text-center text-sm font-semibold ${
                  formaPagamento === forma
                    ? "border-rose-deep bg-rose-soft text-rose-deep"
                    : "border-line bg-cream text-ink"
                }`}
              >
                {FORMA_LABEL_EVENTO[forma]}
              </button>
            ))}
          </div>
        </div>

        {formaPagamento === "cartao_parcelado" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Parcelas</span>
            <select
              value={numeroParcelas}
              onChange={(e) => setNumeroParcelas(Number(e.target.value))}
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            >
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}x de {formatarMoeda(total / n)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-soft">Subtotal</span>
            <span className="tabular-nums">{formatarMoeda(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-soft">Desconto</span>
            <span className="tabular-nums">− {formatarMoeda(descontoNum)}</span>
          </div>
          {descontoBerloques > 0 && (
            <div className="flex justify-between text-rose-deep">
              <span>🎁 Promoção berloques (3+ = R$49,90 cada)</span>
              <span className="tabular-nums">− {formatarMoeda(descontoBerloques)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-ink">
            <span>Valor da compra</span>
            <span className="tabular-nums">{formatarMoeda(totalCalculado)}</span>
          </div>
          <div className="flex items-center justify-between text-xl font-bold text-ink">
            <span>Valor cobrado</span>
            <div className="flex items-center gap-1">
              <span className="text-sm font-normal text-text-soft">R$</span>
              <input
                value={totalManual ?? total.toFixed(2).replace(".", ",")}
                onChange={(e) => setTotalManual(e.target.value === "" ? null : e.target.value)}
                inputMode="decimal"
                className="w-28 rounded-lg border border-line bg-cream px-2 py-1 text-right text-xl font-bold tabular-nums text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
            </div>
          </div>
          <p className="text-right text-xs text-text-soft">
            Use pra somar o juros da maquininha quando cobrar à parte — o valor da compra acima não muda.
          </p>
          {totalManual !== null && (
            <p className="text-right text-xs text-text-soft">
              Diferente do valor da compra —{" "}
              <button type="button" onClick={() => setTotalManual(null)} className="font-semibold text-rose-deep hover:underline">
                voltar ao valor da compra
              </button>
            </p>
          )}
        </div>

        {itensAcimaDoEstoque.length > 0 && (
          <p className="text-xs font-semibold text-warn">
            Alguma peça está com quantidade acima do estoque cadastrado — a venda segue mesmo assim.
          </p>
        )}
        {erro && <p className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">{erro}</p>}

        <button
          onClick={finalizarVenda}
          disabled={enviando || carrinho.length === 0}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-3 text-sm font-bold text-gold-ink disabled:opacity-60"
        >
          {enviando ? "Registrando…" : "Finalizar venda"}
        </button>
      </div>

      {leitorCameraAberto && (
        <LeitorCameraModal onCodigoLido={processarCodigo} onFechar={() => setLeitorCameraAberto(false)} />
      )}
    </div>
  );
}
