"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { informarCotacao } from "@/lib/actions/cotacoes";
import { formatarMoeda } from "@/lib/formatar-moeda";
import type { CotacaoDiaria } from "@/lib/types";

// O casamento com `produtos.material` na venda (novo-pedido.tsx) é exato
// (case-insensitive), de propósito: "Ouro" aqui não deve casar com
// "Folheado a ouro" (material diferente, precificado por multiplicador, não
// por cotação) — um match parcial arriscaria aplicar cotação de ouro puro
// num produto banhado. Cadastrar o produto com material exatamente "Ouro"
// ou "Cobre" é o que ativa o cálculo por cotação.
const MATERIAIS_COM_COTACAO = ["Ouro", "Cobre"];

/** Cotação diária (seção 6, decisão registrada em pending_decisions pra
 * 'multiplicador_ouro_cobre'): ouro e cobre usam a cotação do dia como
 * preço-base do grama, com o multiplicador comercial aplicado em cima. */
export function CotacaoDoDia({
  cotacoesHoje,
  podeInformar,
}: {
  cotacoesHoje: CotacaoDiaria[];
  podeInformar: boolean;
}) {
  const cotacaoPorMaterial = new Map(cotacoesHoje.map((c) => [c.material, c.valor]));

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">Cotação do dia</h2>
      <div className="flex flex-wrap gap-4">
        {MATERIAIS_COM_COTACAO.map((material) => (
          <LinhaMaterial
            key={material}
            material={material}
            valorAtual={cotacaoPorMaterial.get(material) ?? null}
            podeInformar={podeInformar}
          />
        ))}
      </div>
    </div>
  );
}

function LinhaMaterial({
  material,
  valorAtual,
  podeInformar,
}: {
  material: string;
  valorAtual: number | null;
  podeInformar: boolean;
}) {
  const [valor, setValor] = useState(valorAtual != null ? String(valorAtual) : "");
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  function salvar() {
    const numero = Number(valor.replace(",", "."));
    if (!Number.isFinite(numero) || numero <= 0) {
      setErro("Informe um valor válido.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await informarCotacao(material, numero);
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">{material} (R$/grama)</span>
      {podeInformar ? (
        <div className="flex items-center gap-2">
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
            className="w-28 rounded-lg border border-line bg-cream px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={pending}
            onClick={salvar}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      ) : (
        <span className="text-sm font-semibold text-ink">
          {valorAtual != null ? formatarMoeda(valorAtual) : "Não informada hoje"}
        </span>
      )}
      {erro && <p className="text-xs font-medium text-crit">{erro}</p>}
    </div>
  );
}
