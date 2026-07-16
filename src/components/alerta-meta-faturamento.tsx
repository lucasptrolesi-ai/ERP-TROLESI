"use client";

import { useState, useSyncExternalStore } from "react";
import { Modal } from "@/components/modal";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { hojeIso } from "@/lib/datas";

function chavePorMes(): string {
  return `trolesi-erp:meta-faturamento-dispensada-em:${hojeIso().slice(0, 7)}`;
}

function inscreverStorage(avisar: () => void) {
  window.addEventListener("storage", avisar);
  return () => window.removeEventListener("storage", avisar);
}

function lerDispensadoEsteMes(): boolean {
  return localStorage.getItem(chavePorMes()) === "1";
}

// Mesmo raciocínio do alerta de vencimentos: no servidor não existe
// localStorage, assume "já dispensado" (fechado) pra não piscar aberto e
// fechar de novo assim que o cliente hidratar.
function lerDispensadoEsteMesNoServidor(): boolean {
  return true;
}

export function AlertaMetaFaturamento({ faturamentoMes, meta }: { faturamentoMes: number; meta: number }) {
  const bateuMeta = faturamentoMes >= meta;
  const dispensadoEsteMes = useSyncExternalStore(
    inscreverStorage,
    lerDispensadoEsteMes,
    lerDispensadoEsteMesNoServidor,
  );
  const [fechadoNestaSessao, setFechadoNestaSessao] = useState(false);
  const [forcarAberto, setForcarAberto] = useState(false);

  if (!bateuMeta) return null;

  const aberto = forcarAberto || (!dispensadoEsteMes && !fechadoNestaSessao);

  function fechar() {
    setForcarAberto(false);
    setFechadoNestaSessao(true);
  }

  function dispensar() {
    localStorage.setItem(chavePorMes(), "1");
    fechar();
  }

  return (
    <>
      {!aberto && (
        <button
          onClick={() => setForcarAberto(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2.5 text-sm font-semibold text-[#3b2914] shadow-lg print:hidden"
        >
          🎉 Meta batida
        </button>
      )}

      {aberto && (
        <Modal aberto onFechar={fechar} titulo="🎉 Meta do mês batida!">
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm text-text-soft">
              O faturamento deste mês já passou de{" "}
              <span className="font-semibold text-ink">{formatarMoeda(meta)}</span>:
            </p>
            <p className="font-display text-3xl font-semibold text-rose-deep">{formatarMoeda(faturamentoMes)}</p>
            <div className="flex gap-3">
              <button
                onClick={dispensar}
                className="flex-1 rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text-soft"
              >
                Não mostrar de novo este mês
              </button>
              <button
                onClick={fechar}
                className="flex-1 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2.5 text-sm font-semibold text-white"
              >
                🎉 Boa!
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
