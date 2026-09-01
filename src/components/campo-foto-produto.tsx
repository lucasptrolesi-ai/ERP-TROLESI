"use client";

import { useRef, useState } from "react";
import { PareamentoCameraCelular } from "@/components/pareamento-camera-celular";

// Compartilhado entre ProdutoForm (Estoque real) e ProdutoEventoForm (PDV
// Eventos) — os dois sobem pro mesmo bucket produtos-fotos (Storage), só o
// server action de cada um muda o caminho/tabela. Sem foto nova escolhida
// (arquivo local nem foto do celular), o server action mantém a foto atual
// (campo oculto carrega a URL existente pra não se perder na submissão).
export function CampoFotoProduto({
  fotoAtual,
  prefixoCelular,
}: {
  fotoAtual: string | null | undefined;
  prefixoCelular: "manual" | "evento";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewLocal, setPreviewLocal] = useState<string | null>(null);
  const [fotoCelular, setFotoCelular] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState(false);

  const fotoParaManter = fotoCelular ?? fotoAtual ?? null;
  const exibida = previewLocal ?? fotoParaManter;

  function removerEscolha() {
    if (inputRef.current) inputRef.current.value = "";
    setPreviewLocal(null);
    setFotoCelular(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="foto" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
        Foto do produto
      </label>
      {exibida && (
        <div className="group relative h-24 w-24">
          {/* eslint-disable-next-line @next/next/no-img-element -- preview local (blob:) ou foto já salva (Storage), mesmo padrão do grid de Estoque */}
          <img src={exibida} alt="" className="h-24 w-24 rounded-lg border border-line object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setAmpliada(true)}
              aria-label="Ampliar foto"
              title="Ampliar"
              className="rounded-full bg-white/90 px-2 py-1 text-sm"
            >
              🔍
            </button>
            <button
              type="button"
              onClick={removerEscolha}
              aria-label="Remover foto"
              title="Remover"
              className="rounded-full bg-white/90 px-2 py-1 text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        id="foto"
        type="file"
        name="foto"
        accept="image/*"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          setPreviewLocal(arquivo ? URL.createObjectURL(arquivo) : null);
        }}
        className="text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-rose-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-rose-deep"
      />
      <PareamentoCameraCelular
        prefixo={prefixoCelular}
        onFoto={(url) => {
          setFotoCelular(url);
          setPreviewLocal(null);
        }}
      />
      {fotoParaManter && <input type="hidden" name="foto_url_atual" value={fotoParaManter} />}

      {ampliada && exibida && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setAmpliada(false)}
        >
          <button
            type="button"
            onClick={() => setAmpliada(false)}
            aria-label="Fechar"
            className="absolute right-5 top-5 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- mesma URL já validada acima, só ampliada */}
          <img src={exibida} alt="" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
