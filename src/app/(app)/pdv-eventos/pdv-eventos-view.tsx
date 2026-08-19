"use client";

import { useState } from "react";
import { VenderEvento } from "./vender-evento";
import { EstoqueEvento } from "./estoque-evento";
import { ResumoEvento } from "./resumo-evento";
import type { ProdutoEvento, VendaEvento } from "@/lib/types";

type Aba = "vender" | "estoque" | "resumo";

export function PdvEventosView({
  produtosEvento,
  vendasEvento,
}: {
  produtosEvento: ProdutoEvento[];
  vendasEvento: VendaEvento[];
}) {
  const [aba, setAba] = useState<Aba>("vender");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 rounded-[14px] border border-rose bg-rose-soft px-4 py-2.5 sm:px-5">
        <span className="text-sm font-semibold text-rose-deep">🎪 Estoque e vendas separados do sistema principal — uso exclusivo de evento</span>
      </div>

      <div className="rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex gap-6 border-b border-line px-4 sm:px-5">
          <button
            onClick={() => setAba("vender")}
            className={`border-b-2 py-3 text-sm font-semibold ${
              aba === "vender" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Vender
          </button>
          <button
            onClick={() => setAba("estoque")}
            className={`border-b-2 py-3 text-sm font-semibold ${
              aba === "estoque" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Estoque
          </button>
          <button
            onClick={() => setAba("resumo")}
            className={`border-b-2 py-3 text-sm font-semibold ${
              aba === "resumo" ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            Resumo
          </button>
        </div>

        {aba === "vender" && <VenderEvento produtosEvento={produtosEvento} />}
        {aba === "estoque" && <EstoqueEvento produtosEvento={produtosEvento} />}
        {aba === "resumo" && <ResumoEvento vendasEvento={vendasEvento} produtosEvento={produtosEvento} />}
      </div>
    </div>
  );
}
