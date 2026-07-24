"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  buscarStatusImportacaoGmax,
  confirmarImportacaoGmax,
  criarSolicitacaoImportacaoGmax,
  type PedidoResolvidoGmax,
} from "@/lib/actions/gmax";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";

type Fase =
  | { tipo: "inicial" }
  | { tipo: "buscando" }
  | { tipo: "bloqueado"; motivos: { gmax_pedido_id: number; motivo: string }[] }
  | { tipo: "revisao"; solicitacaoId: string; pedidos: PedidoResolvidoGmax[] }
  | { tipo: "concluido"; importados: number; jaExistentes: number }
  | { tipo: "erro"; mensagem: string };

const INTERVALO_POLLING_MS = 2000;
// A leitura do Firebird (cópia do arquivo + várias tabelas) demora mais que
// um job de impressão — dá um minuto de tentativas antes de desistir.
const TENTATIVAS_POLLING = 30;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function totalPedido(pedido: PedidoResolvidoGmax): number {
  return pedido.itens.reduce((soma, item) => soma + item.quantidade * item.preco_unitario, 0);
}

export function GmaxView() {
  const [fase, setFase] = useState<Fase>({ tipo: "inicial" });
  const [confirmando, iniciarConfirmacao] = useTransition();
  // Mesmo motivo do `imprimindoRef` em cupom-view.tsx: bloqueia um segundo
  // clique durante a janela assíncrona antes do re-render de `disabled`
  // chegar, sem depender só do estado.
  const buscandoRef = useRef(false);

  const buscar = useCallback(async () => {
    if (buscandoRef.current) return;
    buscandoRef.current = true;
    setFase({ tipo: "buscando" });

    // try/finally garante que o ref é liberado mesmo se alguma chamada
    // acima lançar uma exceção inesperada (ex: falha de rede) — sem isso,
    // o botão ficaria travado em "buscando" pra sempre até recarregar a
    // página.
    try {
      const solicitacao = await criarSolicitacaoImportacaoGmax();
      if (solicitacao.erro || !solicitacao.id) {
        setFase({ tipo: "erro", mensagem: solicitacao.erro ?? "Não foi possível iniciar a busca." });
        return;
      }

      for (let tentativa = 0; tentativa < TENTATIVAS_POLLING; tentativa++) {
        await aguardar(INTERVALO_POLLING_MS);
        const status = await buscarStatusImportacaoGmax(solicitacao.id);
        if (!status) continue;

        if (status.status === "bloqueado") {
          setFase({ tipo: "bloqueado", motivos: status.relatorio?.bloqueios ?? [] });
          return;
        }
        if (status.status === "erro") {
          setFase({ tipo: "erro", mensagem: status.erro ?? "O agente relatou um erro ao buscar as vendas." });
          return;
        }
        if (status.status === "pronto_para_revisao") {
          setFase({
            tipo: "revisao",
            solicitacaoId: solicitacao.id,
            pedidos: status.relatorio?.pedidos ?? [],
          });
          return;
        }
      }

      setFase({
        tipo: "erro",
        mensagem:
          "Não recebi resposta do agente local em 1 minuto — verifique se ele está rodando na máquina do GMax.",
      });
    } catch {
      setFase({ tipo: "erro", mensagem: "Erro inesperado ao buscar as vendas. Tente novamente." });
    } finally {
      buscandoRef.current = false;
    }
  }, []);

  function confirmar(solicitacaoId: string) {
    iniciarConfirmacao(async () => {
      const resultado = await confirmarImportacaoGmax(solicitacaoId);
      if (resultado.erro) {
        setFase({ tipo: "erro", mensagem: resultado.erro });
        return;
      }
      setFase({
        tipo: "concluido",
        importados: resultado.importados ?? 0,
        jaExistentes: resultado.jaExistentes ?? 0,
      });
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Importar vendas do GMax</h1>
        <p className="mt-1 text-sm text-text-soft">
          Busca vendas lançadas direto no GMax (fora do PDV do Trolesi) e mostra uma prévia antes de
          gravar qualquer coisa.
        </p>
      </div>

      {(fase.tipo === "inicial" || fase.tipo === "erro") && (
        <div className="flex flex-col items-start gap-3">
          {fase.tipo === "erro" && (
            <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
              {fase.mensagem}
            </p>
          )}
          <button
            type="button"
            onClick={buscar}
            className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
          >
            🔄 Buscar vendas novas do GMax
          </button>
        </div>
      )}

      {fase.tipo === "buscando" && (
        <p className="text-sm text-text-soft">
          Buscando no GMax… o agente local precisa copiar e ler o arquivo, pode levar alguns
          segundos.
        </p>
      )}

      {fase.tipo === "bloqueado" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-crit">
            Encontrei venda(s) com algo que não sei resolver sozinho — nada foi importado ainda.
          </p>
          <ul className="flex flex-col gap-1.5 rounded-lg border border-crit bg-crit-bg p-3 text-sm text-crit">
            {fase.motivos.map((b, i) => (
              <li key={i}>
                Pedido GMax #{b.gmax_pedido_id}: {b.motivo}
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-soft">
            Resolva o que estiver listado (ex: cadastre o produto faltante, ou ajuste manualmente
            no GMax) e busque de novo.
          </p>
          <button
            type="button"
            onClick={buscar}
            className="self-start rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
          >
            Buscar de novo
          </button>
        </div>
      )}

      {fase.tipo === "revisao" && (
        <div className="flex flex-col gap-3">
          {fase.pedidos.length === 0 ? (
            <p className="text-sm text-text-soft">Nenhuma venda nova encontrada no GMax.</p>
          ) : (
            <>
              <p className="text-sm text-text-soft">
                {fase.pedidos.length} venda(s) encontrada(s) — confira antes de importar:
              </p>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-cream text-xs uppercase tracking-wide text-text-soft">
                    <tr>
                      <th className="px-3 py-2 text-left">GMax #</th>
                      <th className="px-3 py-2 text-left">Cliente</th>
                      <th className="px-3 py-2 text-left">Pagamento</th>
                      <th className="px-3 py-2 text-left">Itens</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fase.pedidos.map((p) => (
                      <tr key={p.gmax_pedido_id} className="border-t border-line">
                        <td className="px-3 py-2">{p.gmax_pedido_id}</td>
                        <td className="px-3 py-2">
                          {p.cliente.nome}
                          {!p.cliente.id && (
                            <span className="ml-1.5 rounded-full bg-rose-soft px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-rose-deep">
                              novo
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {FORMA_LABEL[p.forma_pagamento] ?? p.forma_pagamento}
                          {p.parcelas.length > 1 && ` (${p.parcelas.length}x)`}
                        </td>
                        <td className="px-3 py-2">{p.itens.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatarMoeda(totalPedido(p))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => confirmar(fase.solicitacaoId)}
                disabled={confirmando}
                className="self-start rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
              >
                {confirmando ? "Importando…" : `Confirmar e importar ${fase.pedidos.length} pedido(s)`}
              </button>
            </>
          )}
        </div>
      )}

      {fase.tipo === "concluido" && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm font-semibold text-ok">
            ✓ {fase.importados} pedido(s) importado(s)
            {fase.jaExistentes > 0 && ` (${fase.jaExistentes} já tinham sido importados antes)`}.
          </p>
          <button
            type="button"
            onClick={buscar}
            className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink"
          >
            Buscar de novo
          </button>
        </div>
      )}
    </div>
  );
}
