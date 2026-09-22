"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { arredondarMoeda, lerMoeda } from "@/lib/dinheiro";
import { filtra } from "@/lib/filtra";
import { cancelarVenda, registrarVenda } from "@/lib/actions/varejo";
import { calcularLinha, calcularTotais, calcularTroco, type ItemCarrinho } from "@/lib/varejo/carrinho";
import { Modal } from "@/components/modal";
import { PinSupervisorModal } from "@/components/pin-supervisor-modal";
import type { FormaPagamento, ItemCatalogo, PagamentoDaVenda, SessaoCaixa, Supervisor, VendaDaSessao } from "@/lib/varejo/tipos";

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
}: {
  sessao: SessaoCaixa | null;
  catalogo: ItemCatalogo[];
  supervisores: Supervisor[];
  vendas: VendaDaSessao[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [forma, setForma] = useState<FormaPagamento>("dinheiro");
  const [valorRecebidoTexto, setValorRecebidoTexto] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pinAberto, setPinAberto] = useState(false);
  const [autorizacaoDesconto, setAutorizacaoDesconto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();

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
  }

  function mudarQuantidade(variacaoId: string, delta: number) {
    setCarrinho((atual) =>
      atual
        .map((l) => (l.variacao.variacao_id === variacaoId ? { ...l, quantidade: l.quantidade + delta } : l))
        .filter((l) => l.quantidade > 0),
    );
  }

  function mudarPreco(variacaoId: string, texto: string) {
    setCarrinho((atual) => atual.map((l) => (l.variacao.variacao_id === variacaoId ? { ...l, precoTexto: texto } : l)));
    setAutorizacaoDesconto(null);
  }

  // Matematica do carrinho (preco travado no maximo de tabela, piso, subtotal/total, troco) em
  // src/lib/varejo/carrinho.ts, testada isoladamente — nao repetida aqui.
  const linhas = carrinho.map(calcularLinha);
  const { subtotal, total, precisaAutorizacao } = calcularTotais(linhas);
  const valorRecebido = lerMoeda(valorRecebidoTexto) ?? 0;
  const troco = calcularTroco(forma, valorRecebido, total);

  function limparVenda() {
    setCarrinho([]);
    setValorRecebidoTexto("");
    setClienteNome("");
    setAutorizacaoDesconto(null);
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
    if (forma === "dinheiro" && valorRecebido < total) {
      setErro("O valor recebido é menor que o total.");
      return;
    }
    const pagamentos: PagamentoDaVenda[] =
      forma === "dinheiro" ? [{ forma, valor: valorRecebido }] : [{ forma, valor: total }];

    iniciarEnvio(async () => {
      const resultado = await registrarVenda({
        sessaoId: sessao!.sessao_id,
        itens: linhas.map((l) => ({ variacao_id: l.variacao.variacao_id, quantidade: l.quantidade, preco_unitario: l.preco })),
        pagamentos,
        idempotencyKey,
        clienteNome: clienteNome || undefined,
        autorizacaoDescontoId: autorizacaoDesconto ?? undefined,
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setSucesso(`Venda registrada${forma === "dinheiro" && troco > 0 ? ` — troco: ${formatarMoeda(troco)}` : ""}.`);
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
              disabled={item.saldo <= 0}
              className="rounded-lg border border-line p-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <p className="font-semibold">{item.nome}</p>
              <p className="text-xs text-text-soft">{Object.values(item.atributos ?? {}).join(" · ") || item.sku}</p>
              <p className="mt-1">
                {formatarMoeda(item.preco_venda)} · {item.saldo > 0 ? `${item.saldo} un` : "sem saldo"}
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
            <span>{formatarMoeda(arredondarMoeda(subtotal - total))}</span>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <span>Total</span>
            <span>{formatarMoeda(total)}</span>
          </div>
        </div>

        <input
          type="text"
          value={clienteNome}
          onChange={(e) => setClienteNome(e.target.value)}
          placeholder="Nome do cliente (opcional)"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
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
