"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";

const INTERVALO_POLLING_MS = 1500;

function chaveSessao(prefixo: string) {
  return `camera-celular-sessao:${prefixo}`;
}
function chaveConfirmado(prefixo: string) {
  return `camera-celular-confirmado:${prefixo}`;
}

/** Pareia o formulário atual com a câmera do celular (2026-09-01): o
 * celular abre um link (via QR) uma única vez e fica com uma página aberta
 * o dia inteiro tirando fotos — cada foto sobe direto pro Storage a partir
 * do próprio celular, e o aviso de "tem foto nova" chega aqui por polling
 * em fotos_celular_pendentes (mesmo raciocínio do print-agent: um lado
 * grava, o outro fica checando — ver migration 20260901000001). Trocado de
 * Realtime Broadcast pra isso depois de um CHANNEL_ERROR em produção sem
 * causa raiz clara — polling é mais lento (~1.5s) mas nunca perde a foto.
 * Fonte de verdade do pareamento é o sessionStorage (por aba do navegador,
 * um por contexto manual/evento já que cada um sobe pra uma subpasta
 * diferente do bucket) — lido via useSyncExternalStore pra não piscar
 * server/client e não violar a regra de não fazer setState direto dentro
 * de um efeito. */
export function PareamentoCameraCelular({
  prefixo,
  onFoto,
}: {
  prefixo: "manual" | "evento";
  onFoto: (url: string) => void;
}) {
  const ouvintesRef = useRef(new Set<() => void>());
  const inscrever = useCallback((ouvinte: () => void) => {
    ouvintesRef.current.add(ouvinte);
    return () => {
      ouvintesRef.current.delete(ouvinte);
    };
  }, []);
  const avisar = useCallback(() => {
    ouvintesRef.current.forEach((ouvinte) => ouvinte());
  }, []);

  const sessionId = useSyncExternalStore(
    inscrever,
    () => sessionStorage.getItem(chaveSessao(prefixo)),
    () => null,
  );
  const confirmado = useSyncExternalStore(
    inscrever,
    () => sessionStorage.getItem(chaveConfirmado(prefixo)) === "1",
    () => false,
  );

  const [qrEstado, setQrEstado] = useState<{ sessionId: string; dataUrl: string } | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const supabase = createClient();
    let cancelado = false;

    async function checar() {
      const { data } = await supabase
        .from("fotos_celular_pendentes")
        .select("id, foto_url")
        .eq("session_id", sessionId)
        .order("criado_em", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelado || !data) return;

      await supabase.from("fotos_celular_pendentes").delete().eq("id", data.id);
      if (cancelado) return;

      sessionStorage.setItem(chaveConfirmado(prefixo), "1");
      avisar();
      onFoto(data.foto_url);
    }

    checar();
    const intervalo = setInterval(checar, INTERVALO_POLLING_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFoto muda a cada render (closure do estado do form); reiniciar o polling por causa disso reabriria a corrida que a gente quer evitar
  }, [sessionId, prefixo, avisar]);

  useEffect(() => {
    if (!sessionId || confirmado) return;
    let cancelado = false;
    const url = `${window.location.origin}/camera/${sessionId}?prefixo=${prefixo}`;
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then((dataUrl) => {
      if (!cancelado) setQrEstado({ sessionId, dataUrl });
    });
    return () => {
      cancelado = true;
    };
  }, [sessionId, confirmado, prefixo]);

  function parear() {
    const novoId = crypto.randomUUID();
    sessionStorage.setItem(chaveSessao(prefixo), novoId);
    sessionStorage.removeItem(chaveConfirmado(prefixo));
    avisar();
  }

  if (!sessionId) {
    return (
      <button
        type="button"
        onClick={parear}
        className="self-start rounded-full border border-rose-soft px-3 py-1.5 text-xs font-semibold text-rose-deep transition hover:bg-rose-soft"
      >
        📱 Cadastrar foto pelo celular
      </button>
    );
  }

  if (confirmado) {
    return (
      <p className="text-xs text-text-soft">
        📱 Celular pareado — tire a foto por lá que ela aparece aqui sozinha.{" "}
        <button type="button" onClick={parear} className="font-semibold text-rose-deep hover:underline">
          Parear outro celular
        </button>
      </p>
    );
  }

  const qrDataUrl = qrEstado?.sessionId === sessionId ? qrEstado.dataUrl : null;

  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-cream/50 p-3">
      <p className="text-xs text-text-soft">
        Abra a câmera do celular e leia o código abaixo (só precisa fazer isso uma vez).
      </p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- QR gerado localmente em data URL, sem otimização de imagem cabível
        <img src={qrDataUrl} alt="QR code para parear a câmera do celular" className="h-40 w-40" />
      )}
      <p className="text-xs text-text-soft">Aguardando a primeira foto do celular…</p>
    </div>
  );
}
