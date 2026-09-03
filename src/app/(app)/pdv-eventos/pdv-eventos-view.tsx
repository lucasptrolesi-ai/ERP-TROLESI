"use client";

import { useState } from "react";
import { VenderEvento } from "./vender-evento";
import { EstoqueEvento } from "./estoque-evento";
import { ResumoEvento } from "./resumo-evento";
import { CuponsEvento } from "./cupons-evento";
import { CaixaEvento } from "./caixa-evento";
import type { CupomEvento, MovimentoCaixaEvento, ProdutoEvento, ProdutoParaImportar, VendaEvento } from "@/lib/types";

type Aba = "vender" | "estoque" | "resumo" | "cupons" | "caixa";

export function PdvEventosView({
  produtosEvento,
  vendasEvento,
  produtosReais,
  cotacaoOuroHoje,
  cupons,
  movimentos,
  valorAberturaHoje,
}: {
  produtosEvento: ProdutoEvento[];
  vendasEvento: VendaEvento[];
  produtosReais: ProdutoParaImportar[];
  cotacaoOuroHoje: number | null;
  cupons: CupomEvento[];
  movimentos: MovimentoCaixaEvento[];
  valorAberturaHoje: number | null;
}) {
  const [aba, setAba] = useState<Aba>("vender");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 rounded-[14px] border border-rose bg-rose-soft px-4 py-2.5 sm:px-5">
        <span className="text-sm font-semibold text-rose-deep">🎪 Estoque e vendas separados do sistema principal — uso exclusivo de evento</span>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex gap-6 overflow-x-auto border-b border-line px-4 sm:px-5">
          <button
            onClick={() => setAba("vender")}
            className={`shrink-0 border-b-2 py-3 text-sm font-semibold ${
              aba === "vender" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Vender
          </button>
          <button
            onClick={() => setAba("estoque")}
            className={`shrink-0 border-b-2 py-3 text-sm font-semibold ${
              aba === "estoque" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Estoque
          </button>
          <button
            onClick={() => setAba("resumo")}
            className={`shrink-0 border-b-2 py-3 text-sm font-semibold ${
              aba === "resumo" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Resumo
          </button>
          <button
            onClick={() => setAba("cupons")}
            className={`shrink-0 border-b-2 py-3 text-sm font-semibold ${
              aba === "cupons" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Cupons
          </button>
          <button
            onClick={() => setAba("caixa")}
            className={`shrink-0 border-b-2 py-3 text-sm font-semibold ${
              aba === "caixa" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Caixa
          </button>
        </div>

        {aba === "vender" && <VenderEvento produtosEvento={produtosEvento} cupons={cupons} />}
        {aba === "estoque" && (
          <EstoqueEvento produtosEvento={produtosEvento} produtosReais={produtosReais} cotacaoOuroHoje={cotacaoOuroHoje} />
        )}
        {aba === "resumo" && <ResumoEvento vendasEvento={vendasEvento} produtosEvento={produtosEvento} />}
        {aba === "cupons" && <CuponsEvento cupons={cupons} />}
        {aba === "caixa" && (
          <CaixaEvento vendasEvento={vendasEvento} movimentos={movimentos} valorAberturaHoje={valorAberturaHoje} />
        )}
      </div>
    </div>
  );
}
