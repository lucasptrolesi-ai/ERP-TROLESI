"use client";

import { useEffect, useRef, useState } from "react";
import { hojeIso } from "@/lib/datas";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { buscarVendasEvento } from "@/lib/actions/pdv-eventos";
import { DIAS_EVENTO, META_BRUTA_IDEAL, META_TRABALHO, PONTO_EQUILIBRIO, TICKET_ALVO } from "@/lib/metas-evento";
import {
  diaEventoDe,
  lucroProjetado,
  metaDoDia,
  numeroDeVendas,
  pecasPorVenda,
  realizado,
  realizadoAcumuladoAte,
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
// só leitura, nunca altera venda/estoque/financeiro. 5 fases com
// checkpoint, esta é a última (tabela dos 4 dias + auto-refresh + estado
// offline). Fundo escuro/dourado em todos os blocos — reaproveita o
// degradê café da sidebar (globals.css) em vez dos cards claros do resto
// do Resumo, pro painel se destacar como "olhada de 3 segundos" (spec §4).

const INTERVALO_ATUALIZACAO_MS = 60_000;

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
    // Fora do período do evento (spec §6) — a tabela dos 4 dias logo
    // abaixo já é o "consolidado final"; evita duplicar o mesmo dado aqui,
    // só aponta pra ela.
    return (
      <BlocoCard>
        <p className="text-center text-sm font-semibold text-sidebar-text">🎪 Painel de metas — Agroshow Itajubá</p>
        <p className="mt-1 text-center text-xs text-sidebar-text/70">
          Fora do período do evento (03 a 06/09) — veja o consolidado na tabela abaixo.
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

function TabelaDias({ vendasEvento, hoje }: { vendasEvento: VendaEvento[]; hoje: string }) {
  return (
    <BlocoCard>
      <p className="text-xs font-bold uppercase tracking-wide text-sidebar-text/70">Os 4 dias do evento</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-sidebar-text/60">
              <th className="py-1 pr-2 font-semibold">Dia</th>
              <th className="py-1 pr-2 text-right font-semibold">Meta</th>
              <th className="py-1 pr-2 text-right font-semibold">Realizado</th>
              <th className="py-1 pr-2 text-right font-semibold">%</th>
              <th className="py-1 text-right font-semibold">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {DIAS_EVENTO.map((dia) => {
              const ehHoje = dia.data === hoje;
              const ehFuturo = dia.data > hoje;
              const meta = metaDoDia(dia);
              const realizadoDia = ehFuturo ? 0 : realizadoDoDia(vendasEvento, dia.data);
              const pct = meta > 0 ? (realizadoDia / meta) * 100 : 0;
              const acumuladoDia = realizadoAcumuladoAte(vendasEvento, dia);

              return (
                <tr
                  key={dia.data}
                  className={`border-t border-white/10 ${
                    ehHoje ? "font-bold text-[#f3ded6]" : ehFuturo ? "text-sidebar-text/40" : "text-sidebar-text"
                  }`}
                >
                  <td className="py-1.5 pr-2">{dia.dia}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatarMoeda(meta)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {ehFuturo ? "—" : formatarMoeda(realizadoDia)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{ehFuturo ? "—" : `${pct.toFixed(0)}%`}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatarMoeda(acumuladoDia)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </BlocoCard>
  );
}

export function PainelMetas({ vendasEvento: vendasIniciais }: { vendasEvento: VendaEvento[] }) {
  const [vendas, setVendas] = useState(vendasIniciais);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(() => Date.now());
  const [comErro, setComErro] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const emVooRef = useRef(false);

  async function atualizar() {
    if (emVooRef.current) return;
    emVooRef.current = true;
    setAtualizando(true);
    try {
      const resultado = await buscarVendasEvento();
      if ("erro" in resultado) {
        setComErro(true);
      } else {
        setVendas(resultado.vendas);
        setUltimaAtualizacao(Date.now());
        setComErro(false);
      }
    } catch {
      // Internet ruim/instável (spec §6) — mantém o último valor em tela,
      // nunca zera, só acende o aviso de desatualizado.
      setComErro(true);
    } finally {
      setAgora(Date.now());
      setAtualizando(false);
      emVooRef.current = false;
    }
  }

  useEffect(() => {
    const intervalo = setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(intervalo);
  }, []);

  const hoje = hojeIso();
  // Acumulado/Ticket médio/Tabela olham pro evento inteiro (spec §5: só
  // dados dentro de 03-06/09), não só pro dia de hoje — diferente do bloco
  // Hoje.
  const vendasNoEvento = vendasDoEvento(vendas);
  const minutosDesatualizado = Math.floor((agora - ultimaAtualizacao) / 60_000);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        {comErro ? (
          <p className="text-xs font-semibold text-warn">
            ⚠ Desatualizado há {minutosDesatualizado <= 0 ? "menos de 1 min" : `${minutosDesatualizado} min`} —
            confira a internet
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={atualizar}
          disabled={atualizando}
          className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-text-soft disabled:opacity-60"
        >
          {atualizando ? "Atualizando…" : "🔄 Atualizar"}
        </button>
      </div>

      <BlocoHoje vendasEvento={vendas} hoje={hoje} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BlocoAcumulado vendasNoEvento={vendasNoEvento} />
        <BlocoTicketMedio vendasNoEvento={vendasNoEvento} />
      </div>
      <TabelaDias vendasEvento={vendas} hoje={hoje} />
    </div>
  );
}
