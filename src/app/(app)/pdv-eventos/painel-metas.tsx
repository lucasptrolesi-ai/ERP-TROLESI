"use client";

import { hojeIso } from "@/lib/datas";
import { formatarMoeda } from "@/lib/formatar-moeda";
import {
  diaEventoDe,
  metaDoDia,
  numeroDeVendas,
  realizadoDoDia,
  semaforo,
  vendasDoDia,
  vendasNecessarias,
  type Semaforo,
} from "@/lib/metas-evento-calculo";
import type { VendaEvento } from "@/lib/types";

// Painel de metas do Agroshow Itajubá 2026 (spec do usuário, 2026-08-24) —
// só leitura, nunca altera venda/estoque/financeiro. Construído em fases
// com checkpoint; este arquivo cresce nas próximas (Fase 4: blocos
// Acumulado/Ticket médio; Fase 5: tabela dos 4 dias + auto-refresh).
//
// Fundo escuro/dourado de propósito — reaproveita o degradê café da
// sidebar (globals.css) em vez dos cards claros do resto do Resumo, pra
// esse bloco se destacar como "olhada de 3 segundos" (spec §4.1).

const CLASSE_BARRA: Record<Semaforo, string> = {
  vermelho: "bg-crit",
  ambar: "bg-warn",
  verde: "bg-ok",
};
const CLASSE_TEXTO: Record<Semaforo, string> = {
  vermelho: "text-crit",
  ambar: "text-warn",
  verde: "text-ok",
};

function dataCurta(dataIso: string): string {
  return `${dataIso.slice(8, 10)}/${dataIso.slice(5, 7)}`;
}

const FUNDO_PAINEL = { background: "linear-gradient(135deg, var(--color-sidebar) 0%, var(--color-sidebar-to) 100%)" };

export function PainelMetas({ vendasEvento }: { vendasEvento: VendaEvento[] }) {
  const hoje = hojeIso();
  const diaHoje = diaEventoDe(hoje);

  if (!diaHoje) {
    // Fora do período do evento (spec §6: "mostra o consolidado final em
    // vez do bloco Hoje") — o consolidado de verdade é a tabela dos 4
    // dias, que só chega na Fase 5. Por ora, um aviso claro em vez de
    // sumir sem explicação (importante pra testar antes do evento
    // começar, já que hoje é 2026-08-24 e o evento é só em setembro).
    return (
      <div style={FUNDO_PAINEL} className="rounded-2xl border border-gold-start/30 p-5 text-center shadow-lg">
        <p className="text-sm font-semibold text-sidebar-text">🎪 Painel de metas — Agroshow Itajubá</p>
        <p className="mt-1 text-xs text-sidebar-text/70">
          Fora do período do evento (03 a 06/09) — volta a mostrar o dia atual automaticamente quando a feira
          começar.
        </p>
      </div>
    );
  }

  const vendasHoje = vendasDoDia(vendasEvento, hoje);
  const realizadoHoje = realizadoDoDia(vendasEvento, hoje);
  const metaHoje = metaDoDia(diaHoje);
  const percentual = metaHoje > 0 ? realizadoHoje / metaHoje : 0;
  const cor = semaforo(percentual);
  const necessariasHoje = vendasNecessarias(metaHoje);
  const feitasHoje = numeroDeVendas(vendasHoje);
  const diferenca = realizadoHoje - metaHoje;

  return (
    <div style={FUNDO_PAINEL} className="rounded-2xl border border-gold-start/30 p-5 shadow-lg">
      <p className="text-xs font-bold uppercase tracking-wide text-sidebar-text/70">
        Hoje — {diaHoje.dia}, {dataCurta(diaHoje.data)}
      </p>

      <p className="mt-1 font-display text-5xl font-bold leading-none text-[#f3ded6]">
        {formatarMoeda(realizadoHoje)}
      </p>
      <p className="mt-1 text-sm text-sidebar-text/80">Meta do dia: {formatarMoeda(metaHoje)}</p>

      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${CLASSE_BARRA[cor]}`}
          style={{ width: `${Math.min(100, Math.max(0, percentual * 100))}%` }}
        />
      </div>

      <p className={`mt-2 text-sm font-bold ${CLASSE_TEXTO[cor]}`}>
        {diferenca >= 0 ? `Meta batida, +${formatarMoeda(diferenca)} acima` : `Faltam ${formatarMoeda(-diferenca)}`}
      </p>
      <p className="text-xs text-sidebar-text/70">
        Ritmo: {feitasHoje} venda(s) hoje / {necessariasHoje} necessária(s)
      </p>
    </div>
  );
}
