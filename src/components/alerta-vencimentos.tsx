"use client";

import { useState, useSyncExternalStore } from "react";
import { Modal } from "@/components/modal";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { hojeIso, formatarDataIso } from "@/lib/datas";
import type { ContaPagarVencendo, ParcelaVencendo } from "@/lib/types";

const CHAVE_DISPENSADO = "trolesi-erp:alerta-vencimentos-dispensado-em";

function inscreverStorage(avisar: () => void) {
  window.addEventListener("storage", avisar);
  return () => window.removeEventListener("storage", avisar);
}

function lerDispensadoHoje(): boolean {
  return localStorage.getItem(CHAVE_DISPENSADO) === hojeIso();
}

// No servidor não existe localStorage — assume "já dispensado" (fechado) pra
// não piscar aberto e fechar de novo assim que o cliente hidratar e ler o
// valor real. useSyncExternalStore troca pro valor real sem warning de
// mismatch de hidratação, diferente de ler localStorage num useEffect e dar
// setState (o que o lint do projeto já rejeita como anti-padrão).
function lerDispensadoHojeNoServidor(): boolean {
  return true;
}

export function AlertaVencimentos({
  parcelasReceber,
  contasPagar,
}: {
  parcelasReceber: ParcelaVencendo[];
  contasPagar: ContaPagarVencendo[];
}) {
  const total = parcelasReceber.length + contasPagar.length;
  const dispensadoHoje = useSyncExternalStore(inscreverStorage, lerDispensadoHoje, lerDispensadoHojeNoServidor);
  const [fechadoNestaSessao, setFechadoNestaSessao] = useState(false);
  const [forcarAberto, setForcarAberto] = useState(false);

  if (total === 0) return null;

  const aberto = forcarAberto || (!dispensadoHoje && !fechadoNestaSessao);

  function fechar() {
    setForcarAberto(false);
    setFechadoNestaSessao(true);
  }

  function dispensar() {
    localStorage.setItem(CHAVE_DISPENSADO, hojeIso());
    fechar();
  }

  const hoje = hojeIso();
  const receberHoje = parcelasReceber.filter((p) => p.vencimento === hoje);
  const receberProximos = parcelasReceber.filter((p) => p.vencimento !== hoje);
  const pagarHoje = contasPagar.filter((c) => c.vencimento === hoje);
  const pagarProximos = contasPagar.filter((c) => c.vencimento !== hoje);

  return (
    <>
      <button
        onClick={() => setForcarAberto(true)}
        aria-label={`${total} conta(s) vencendo — ver alerta`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-base"
      >
        🔔
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[0.65rem] font-bold text-white">
          {total}
        </span>
      </button>

      {aberto && (
        <Modal aberto onFechar={fechar} titulo="Contas vencendo">
          <div className="flex flex-col gap-4">
            {receberHoje.length > 0 && (
              <GrupoReceber titulo="A receber — vencendo hoje" parcelas={receberHoje} tom="crit" />
            )}
            {receberProximos.length > 0 && (
              <GrupoReceber titulo="A receber — próximos dias" parcelas={receberProximos} tom="warn" />
            )}
            {pagarHoje.length > 0 && (
              <GrupoPagar titulo="A pagar — vencendo hoje" contas={pagarHoje} tom="crit" />
            )}
            {pagarProximos.length > 0 && (
              <GrupoPagar titulo="A pagar — próximos dias" contas={pagarProximos} tom="warn" />
            )}

            <div className="flex gap-3 border-t border-line pt-4">
              <button
                onClick={dispensar}
                className="flex-1 rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text-soft"
              >
                Não mostrar novamente hoje
              </button>
              <button
                onClick={fechar}
                className="flex-1 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2.5 text-sm font-semibold text-gold-ink"
              >
                Ok, entendi
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function GrupoReceber({
  titulo,
  parcelas,
  tom,
}: {
  titulo: string;
  parcelas: ParcelaVencendo[];
  tom: "crit" | "warn";
}) {
  return (
    <ListaGrupo titulo={titulo} tom={tom}>
      {parcelas.map((p) => (
        <li
          key={p.id}
          className="flex items-center justify-between rounded-lg border border-line bg-cream px-3 py-2 text-sm"
        >
          <div>
            <p className="font-semibold text-ink">{p.clientes?.nome ?? "Cliente"}</p>
            <p className="text-xs text-text-soft">
              {p.pedidos ? `Pedido #${p.pedidos.numero} · ` : ""}
              vence {formatarDataIso(p.vencimento)}
              {p.clientes?.telefone ? ` · ${p.clientes.telefone}` : ""}
            </p>
          </div>
          <span className="tabular-nums font-semibold text-ink">{formatarMoeda(p.valor)}</span>
        </li>
      ))}
    </ListaGrupo>
  );
}

function GrupoPagar({
  titulo,
  contas,
  tom,
}: {
  titulo: string;
  contas: ContaPagarVencendo[];
  tom: "crit" | "warn";
}) {
  return (
    <ListaGrupo titulo={titulo} tom={tom}>
      {contas.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between rounded-lg border border-line bg-cream px-3 py-2 text-sm"
        >
          <div>
            <p className="font-semibold text-ink">{c.descricao}</p>
            <p className="text-xs text-text-soft">
              {c.fornecedores ? `${c.fornecedores.nome} · ` : ""}
              vence {formatarDataIso(c.vencimento)}
            </p>
          </div>
          <span className="tabular-nums font-semibold text-ink">{formatarMoeda(c.valor)}</span>
        </li>
      ))}
    </ListaGrupo>
  );
}

function ListaGrupo({
  titulo,
  tom,
  children,
}: {
  titulo: string;
  tom: "crit" | "warn";
  children: React.ReactNode;
}) {
  const corTexto = tom === "crit" ? "text-crit" : "text-warn";
  return (
    <div>
      <p className={`mb-1.5 text-xs font-bold uppercase tracking-wide ${corTexto}`}>{titulo}</p>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}
