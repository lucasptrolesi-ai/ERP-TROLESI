"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subirFotoProduto } from "@/lib/actions/foto-produto";

/** Página aberta no celular via QR (uma vez só, ver PareamentoCameraCelular)
 * — fica no ar o dia inteiro tirando fotos de peça em peça. Cada foto sobe
 * direto pro Storage a partir daqui (o celular já está logado no ERP, as
 * mesmas policies de storage.objects valem) e o aviso pro Mac é só uma
 * linha em fotos_celular_pendentes com a URL — o Mac fica consultando essa
 * tabela pelo mesmo session_id (ver migration 20260901000001; trocado de
 * Realtime Broadcast por ser mais simples de garantir entrega: a foto fica
 * salva até o Mac consumir, não se perde se ninguém estiver "ouvindo" no
 * instante exato do envio). */
export function CameraCelularView({
  sessionId,
  prefixo,
}: {
  sessionId: string;
  prefixo: "manual" | "evento";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [ultimaFoto, setUltimaFoto] = useState<string | null>(null);
  const [contagem, setContagem] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;

    setEnviando(true);
    setErro(null);
    const supabase = createClient();
    const resultado = await subirFotoProduto(supabase, arquivo, prefixo);

    if (resultado.erro || !resultado.url) {
      setEnviando(false);
      setErro(resultado.erro ?? "Não foi possível enviar a foto.");
      return;
    }

    const { error } = await supabase
      .from("fotos_celular_pendentes")
      .insert({ session_id: sessionId, prefixo, foto_url: resultado.url });
    setEnviando(false);

    if (error) {
      setErro('Foto salva, mas o aviso pro formulário falhou. Tire outra foto ou tente de novo em instantes.');
      return;
    }

    setUltimaFoto(resultado.url);
    setContagem((n) => n + 1);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream px-6 py-10 text-center">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Câmera do celular</h1>
        <p className="text-sm text-text-soft">
          Trolesi ERP — {prefixo === "evento" ? "PDV Eventos" : "Estoque"}
        </p>
      </div>

      {ultimaFoto && (
        // eslint-disable-next-line @next/next/no-img-element -- preview da última foto enviada, direto da URL pública do Storage
        <img src={ultimaFoto} alt="" className="h-32 w-32 rounded-xl border border-line object-cover" />
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={aoEscolherArquivo}
        className="hidden"
      />
      <button
        type="button"
        disabled={enviando}
        onClick={() => inputRef.current?.click()}
        className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-8 py-4 text-base font-semibold text-gold-ink shadow-lg transition disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "📸 Tirar foto"}
      </button>

      {erro && <p className="text-sm font-medium text-crit">{erro}</p>}
      {contagem > 0 && !erro && (
        <p className="text-sm text-text-soft">
          {contagem} foto{contagem > 1 ? "s" : ""} enviada{contagem > 1 ? "s" : ""} — pode continuar
          cadastrando peças no Mac (leva só alguns segundos pra aparecer).
        </p>
      )}
      <p className="text-xs text-text-soft">
        Deixe esta página aberta — as fotos aparecem sozinhas no formulário do Mac.
      </p>
    </main>
  );
}
