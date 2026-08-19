"use client";

import { useState } from "react";

// Compartilhado entre ProdutoForm (Estoque real) e ProdutoEventoForm (PDV
// Eventos) — os dois sobem pro mesmo bucket produtos-fotos (Storage), só o
// server action de cada um muda o caminho/tabela. Sem foto nova escolhida,
// o server action mantém a foto atual (campo oculto carrega a URL existente
// pra não se perder na submissão).
export function CampoFotoProduto({ fotoAtual }: { fotoAtual: string | null | undefined }) {
  const [preview, setPreview] = useState<string | null>(null);
  const exibida = preview ?? fotoAtual;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="foto" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
        Foto do produto
      </label>
      {exibida && (
        // eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) ou foto já salva (Storage), mesmo padrão do grid de Estoque
        <img src={exibida} alt="" className="h-24 w-24 rounded-lg border border-line object-cover" />
      )}
      <input
        id="foto"
        type="file"
        name="foto"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          setPreview(arquivo ? URL.createObjectURL(arquivo) : null);
        }}
        className="text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-rose-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-rose-deep"
      />
      {fotoAtual && <input type="hidden" name="foto_url_atual" value={fotoAtual} />}
    </div>
  );
}
