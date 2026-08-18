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
  const semSuporte = typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia;
  const [erro, setErro] = useState<string | null>(
    semSuporte ? "Este navegador não dá acesso à câmera. Tente atualizar o app ou usar outro navegador." : null,
  );
  const [carregando, setCarregando] = useState(!semSuporte);
  const [feedback, setFeedback] = useState<{ texto: string; ok: boolean } | null>(null);

  const onCodigoLidoRef = useRef(onCodigoLido);
  const ultimoRef = useRef<{ codigo: string; em: number } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    onCodigoLidoRef.current = onCodigoLido;
  }, [onCodigoLido]);

  useEffect(() => {
    if (semSuporte) return;

    // Sem timeout, um getUserMedia que nunca resolve nem rejeita (visto em
    // alguns navegadores in-app/restritos) deixa a tela parada sem nenhum
    // feedback — parece que "travou" pro usuário, sem erro nem como sair
    // além do botão Fechar.
    const TIMEOUT_MS = 10000;
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 500 });
    let controls: { stop: () => void } | undefined;
    let cancelado = false;
    let expirou = false;
    const timeoutId = setTimeout(() => {
      expirou = true;
      setCarregando(false);
      setErro("A câmera demorou demais pra responder. Verifique a permissão e tente de novo.");
    }, TIMEOUT_MS);

    reader
      .decodeFromConstraints(
        {
          // Resolução baixa de propósito: leitura de código de barras não
          // precisa de imagem em alta, e resolução alta deixa o decode
          // contínuo pesado (trava/esquenta em celular mais fraco).
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        },
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
        clearTimeout(timeoutId);
        if (cancelado || expirou) {
          // Já desistimos (fechado ou estourou o timeout) antes da câmera
          // responder — libera o stream que chegou atrasado.
          c.stop();
        } else {
          controls = c;
          setCarregando(false);
        }
      })
      .catch((e: unknown) => {
        clearTimeout(timeoutId);
        if (cancelado || expirou) return;
        setCarregando(false);
        const nome = e instanceof Error ? e.name : "";
        setErro(
          nome === "NotAllowedError"
            ? "Permissão de câmera negada — confirme o acesso à câmera nas configurações do navegador."
            : "Não foi possível acessar a câmera neste dispositivo.",
        );
      });

    return () => {
      cancelado = true;
      clearTimeout(timeoutId);
      clearTimeout(feedbackTimeoutRef.current);
      controls?.stop();
    };
  }, [semSuporte]);

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
          {carregando && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm font-medium text-white">
              Abrindo câmera… confirme a permissão se o navegador pedir.
            </div>
          )}
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
