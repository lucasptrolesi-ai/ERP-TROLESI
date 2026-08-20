"use client";

import { useState } from "react";

// Passar o mouse em cima mostra a foto em tamanho grande, centralizada na
// tela — usa a mesma imagem já carregada (sem re-hospedar em resolução
// menor em nenhum lugar), então o zoom sai nítido. position: fixed de
// propósito: a miniatura costuma estar dentro de uma tabela com scroll
// horizontal (overflow-x-auto), que cortaria um zoom feito só com CSS
// transform/scale no próprio lugar.
export function FotoComZoom({ src, alt, tamanhoBase }: { src: string; alt?: string; tamanhoBase: string }) {
  const [emFoco, setEmFoco] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- foto do Storage, sem otimização por enquanto (mesmo padrão do grid de Estoque) */}
      <img
        src={src}
        alt={alt ?? ""}
        onMouseEnter={() => setEmFoco(true)}
        onMouseLeave={() => setEmFoco(false)}
        className={`${tamanhoBase} cursor-zoom-in rounded-lg border border-line object-cover`}
      />
      {emFoco && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- mesma foto do Storage, só exibida maior */}
          <img
            src={src}
            alt={alt ?? ""}
            className="max-h-[85vh] max-w-[85vw] rounded-xl border-4 border-white object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
