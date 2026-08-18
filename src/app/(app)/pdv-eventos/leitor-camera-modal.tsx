"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

type ResultadoLeitura = { sucesso: boolean; nomeProduto?: string };

export function LeitorCameraModal({
  onCodigoLido,
  onFechar,
}: {
  onCodigoLido: (codigo: string) => ResultadoLeitura;
  onFechar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ texto: string; ok: boolean } | null>(null);

  const onCodigoLidoRef = useRef(onCodigoLido);
  const ultimoRef = useRef<{ codigo: string; em: number } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    onCodigoLidoRef.current = onCodigoLido;
  }, [onCodigoLido]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | undefined;
    let cancelado = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        (resultado) => {
          if (cancelado || !resultado) return;
          const codigo = resultado.getText().trim();
          const agora = Date.now();
          // Evita adicionar a mesma peça repetidas vezes enquanto a câmera
          // continua enxergando o mesmo código de barras nos frames seguintes.
          if (ultimoRef.current?.codigo === codigo && agora - ultimoRef.current.em < 2000) {
            return;
          }
          ultimoRef.current = { codigo, em: agora };

          const { sucesso, nomeProduto } = onCodigoLidoRef.current(codigo);
          if (navigator.vibrate) navigator.vibrate(sucesso ? 80 : [60, 60, 60]);
          setFeedback({ texto: sucesso ? `✓ ${nomeProduto} adicionada` : "Código não encontrado", ok: sucesso });
          clearTimeout(feedbackTimeoutRef.current);
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 1800);
        },
      )
      .then((c) => {
        if (cancelado) {
          c.stop();
        } else {
          controls = c;
        }
      })
      .catch((e: unknown) => {
        const nome = e instanceof Error ? e.name : "";
        setErro(
          nome === "NotAllowedError"
            ? "Permissão de câmera negada — confirme o acesso à câmera nas configurações do navegador."
            : "Não foi possível acessar a câmera neste dispositivo.",
        );
      });

    return () => {
      cancelado = true;
      clearTimeout(feedbackTimeoutRef.current);
      controls?.stop();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4">
      <div className="flex w-full max-w-sm items-center justify-between">
        <p className="text-sm font-semibold text-white">Aponte a câmera pro código de barras</p>
        <button
          type="button"
          onClick={onFechar}
          className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-white"
        >
          Fechar
        </button>
      </div>

      {erro ? (
        <p className="w-full max-w-sm rounded-lg bg-crit-bg px-3 py-3 text-sm font-medium text-crit">{erro}</p>
      ) : (
        <div className="relative w-full max-w-sm overflow-hidden rounded-xl border-2 border-gold-start">
          <video ref={videoRef} className="w-full" muted playsInline />
          {feedback && (
            <div
              className={`absolute inset-x-0 bottom-0 px-3 py-2.5 text-center text-sm font-bold ${
                feedback.ok ? "bg-ok text-white" : "bg-crit text-white"
              }`}
            >
              {feedback.texto}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
