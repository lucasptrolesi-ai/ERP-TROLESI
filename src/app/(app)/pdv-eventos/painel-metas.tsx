"use client";

import { hojeIso } from "@/lib/datas";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { META_BRUTA_IDEAL, META_TRABALHO, PONTO_EQUILIBRIO, TICKET_ALVO } from "@/lib/metas-evento";
import {
  diaEventoDe,
  lucroProjetado,
  metaDoDia,
  numeroDeVendas,
  pecasPorVenda,
  realizado,
  realizadoDoDia,
  semaforo,
  ticketMedio,
  vendasDoDia,
  vendasDoEvento,
  vendasNecessarias,
  type Semaforo,
} from "@/lib/metas-evento-calculo";
import type { VendaEvento } from "@/lib/types";

// Painel de metas do Agroshow Itajubá 2026 (spec do usuário, 2026-08-24) —
// só leitura, nunca altera venda/estoque/financeiro. Construído em fases
// com checkpoint; este arquivo cresce na próxima (Fase 5: tabela dos 4
// dias + auto-refresh + estado offline).
//
// Fundo escuro/dourado de propósito em todos os blocos — reaproveita o
// degradê café da sidebar (globals.css) em vez dos cards claros do resto
// do Resumo, pro painel se destacar como "olhada de 3 segundos" (spec §4).

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

function BlocoCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={FUNDO_PAINEL} className="rounded-2xl border border-gold-start/30 p-5 shadow-lg">
      {children}
    </div>
  );
}

function BlocoHoje({ vendasEvento, hoje }: { vendasEvento: VendaEvento[]; hoje: string }) {
  const diaHoje = diaEventoDe(hoje);

  if (!diaHoje) {
    // Fora do período do evento (spec §6: "mostra o consolidado final em
    // vez do bloco Hoje") — o consolidado de verdade é a tabela dos 4
    // dias, que só chega na Fase 5. Por ora, um aviso claro em vez de
    // sumir sem explicação (importante pra testar antes do evento
    // começar, já que hoje é 2026-08-24 e o evento é só em setembro).
    return (
      <BlocoCard>
        <p className="text-center text-sm font-semibold text-sidebar-text">🎪 Painel de metas — Agroshow Itajubá</p>
        <p className="mt-1 text-center text-xs text-sidebar-text/70">
          Fora do período do evento (03 a 06/09) — volta a mostrar o dia atual automaticamente quando a feira
          começar.
        </p>
      </BlocoCard>
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
    <BlocoCard>
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
    </BlocoCard>
  );
}

function BlocoAcumulado({ vendasNoEvento }: { vendasNoEvento: VendaEvento[] }) {
  const realizadoAcumuladoValor = realizado(vendasNoEvento);
  const percentual = Math.min(100, Math.max(0, (realizadoAcumuladoValor / META_TRABALHO) * 100));
  const pctEquilibrio = (PONTO_EQUILIBRIO / META_TRABALHO) * 100;
  const pctMetaIdeal = (META_BRUTA_IDEAL / META_TRABALHO) * 100;
  const lucro = lucroProjetado(realizadoAcumuladoValor);

  return (
    <BlocoCard>
      <p className="text-xs font-bold uppercase tracking-wide text-sidebar-text/70">Acumulado do evento</p>
      <p className="mt-1 font-display text-3xl font-bold leading-none text-[#f3ded6]">
        {formatarMoeda(realizadoAcumuladoValor)}{" "}
        <span className="text-base font-normal text-sidebar-text/60">/ {formatarMoeda(META_TRABALHO)}</span>
      </p>

      <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-start to-gold-end transition-all"
          style={{ width: `${percentual}%` }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${pctEquilibrio}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${pctMetaIdeal}%` }} />
      </div>
      <div className="relative mt-1 h-8 text-[0.65rem] leading-tight text-sidebar-text/70">
        <span className="absolute -translate-x-1/2 text-center" style={{ left: `${pctEquilibrio}%` }}>
          paga a
          <br />
          feira
        </span>
        <span className="absolute -translate-x-1/2 text-center" style={{ left: `${pctMetaIdeal}%` }}>
          lucro
          <br />
          R$30k
        </span>
      </div>

      <p className={`mt-2 text-sm font-bold ${lucro >= 0 ? "text-ok" : "text-crit"}`}>
        Lucro projetado: {lucro >= 0 ? "+" : "−"}
        {formatarMoeda(Math.abs(lucro))}
      </p>
    </BlocoCard>
  );
}

function BlocoTicketMedio({ vendasNoEvento }: { vendasNoEvento: VendaEvento[] }) {
  const ticket = ticketMedio(vendasNoEvento);
  const delta = ticket - TICKET_ALVO;
  const peloMenosUmaVenda = numeroDeVendas(vendasNoEvento) > 0;

  return (
    <BlocoCard>
      <p className="text-xs font-bold uppercase tracking-wide text-sidebar-text/70">Ticket médio</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-3xl font-bold leading-none text-[#f3ded6]">{formatarMoeda(ticket)}</p>
        <span className="text-xs text-sidebar-text/60">alvo {formatarMoeda(TICKET_ALVO)}</span>
      </div>
      {peloMenosUmaVenda && (
        <p className={`mt-1 text-sm font-bold ${delta >= 0 ? "text-ok" : "text-crit"}`}>
          {delta >= 0 ? "▲" : "▼"} {formatarMoeda(Math.abs(delta))} {delta >= 0 ? "acima" : "abaixo"} do alvo
        </p>
      )}
      <p className="mt-1 text-xs text-sidebar-text/70">
        {pecasPorVenda(vendasNoEvento).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} peça(s) por venda
      </p>
    </BlocoCard>
  );
}

export function PainelMetas({ vendasEvento }: { vendasEvento: VendaEvento[] }) {
  const hoje = hojeIso();
  // Acumulado/Ticket médio olham pro evento inteiro (spec §5: só dados
  // dentro de 03-06/09), não só pro dia de hoje — diferente do bloco Hoje.
  const vendasNoEvento = vendasDoEvento(vendasEvento);

  return (
    <div className="flex flex-col gap-3">
      <BlocoHoje vendasEvento={vendasEvento} hoje={hoje} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BlocoAcumulado vendasNoEvento={vendasNoEvento} />
        <BlocoTicketMedio vendasNoEvento={vendasNoEvento} />
      </div>
    </div>
  );
}
