"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subirFotoProduto } from "@/lib/actions/foto-produto";

/** Página aberta no celular via QR (uma vez só, ver PareamentoCameraCelular)
 * — fica no ar o dia inteiro tirando fotos de peça em peça. Cada foto sobe
 * direto pro Storage a partir daqui (o celular já está logado no ERP, as
 * mesmas policies de storage.objects valem) e o link com o Mac é só o
 * aviso "a foto X está pronta", via Realtime Broadcast — o próprio arquivo
 * nunca passa pelo canal.
 *
 * O canal fica aberto pro resto da sessão (não um por foto). Mas abrir a
 * câmera nativa (o `capture="environment"` do input) tira o Safari de
 * primeiro plano por alguns segundos, e o iOS pode derrubar o WebSocket
 * nesse meio tempo sem avisar — por isso reconecta sozinho quando a aba
 * volta a ficar visível, e a foto já enviada pro Storage nunca se perde
 * mesmo se o aviso pro formulário falhar (fica pendente com botão de
 * tentar de novo, sem precisar tirar a foto outra vez). */
export function CameraCelularView({
  sessionId,
  prefixo,
}: {
  sessionId: string;
  prefixo: "manual" | "evento";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canalRef = useRef<RealtimeChannel | null>(null);
  const prontoRef = useRef(false);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ultimaFoto, setUltimaFoto] = useState<string | null>(null);
  const [contagem, setContagem] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);

  const conectar = useCallback(() => {
    const supabase = createClient();
    if (canalRef.current) supabase.removeChannel(canalRef.current);
    prontoRef.current = false;

    const canal = supabase.channel(`camera-${sessionId}`);
    canalRef.current = canal;
    canal.subscribe((status) => {
      const conectado = status === "SUBSCRIBED";
      prontoRef.current = conectado;
      setPronto(conectado);
    });
  }, [sessionId]);

  useEffect(() => {
    conectar();

    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible" && !prontoRef.current) conectar();
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      if (canalRef.current) createClient().removeChannel(canalRef.current);
      canalRef.current = null;
    };
  }, [conectar]);

  async function aguardarConexao(prazoMs: number): Promise<boolean> {
    const passo = 250;
    for (let decorrido = 0; decorrido < prazoMs && !prontoRef.current; decorrido += passo) {
      await new Promise((resolve) => setTimeout(resolve, passo));
    }
    return prontoRef.current;
  }

  async function avisarFormulario(url: string): Promise<boolean> {
    if (!(await aguardarConexao(2000))) conectar();
    if (!(await aguardarConexao(3000))) return false;

    const resposta = await canalRef.current?.send({ type: "broadcast", event: "foto", payload: { url } });
    return resposta === "ok";
  }

  async function tentarReenviar() {
    if (!pendente) return;
    setEnviando(true);
    setErro(null);
    const ok = await avisarFormulario(pendente);
    setEnviando(false);

    if (!ok) {
      setErro("Ainda sem conexão com o formulário. Verifique a internet e tente de novo.");
      return;
    }
    setUltimaFoto(pendente);
    setContagem((n) => n + 1);
    setPendente(null);
  }

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;

    setEnviando(true);
    setErro(null);
    setPendente(null);
    const supabase = createClient();
    const resultado = await subirFotoProduto(supabase, arquivo, prefixo);

    if (resultado.erro || !resultado.url) {
      setEnviando(false);
      setErro(resultado.erro ?? "Não foi possível enviar a foto.");
      return;
    }

    const ok = await avisarFormulario(resultado.url);
    setEnviando(false);

    if (!ok) {
      setPendente(resultado.url);
      setErro('Foto salva, mas o aviso pro formulário falhou. Toque em "Tentar de novo".');
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
      {!pronto && !enviando && (
        <p className="text-xs text-text-soft">Conectando ao formulário… (pode tirar a foto normalmente)</p>
      )}

      {erro && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-medium text-crit">{erro}</p>
          {pendente && (
            <button
              type="button"
              onClick={tentarReenviar}
              disabled={enviando}
              className="rounded-full border border-rose-soft px-4 py-1.5 text-xs font-semibold text-rose-deep disabled:opacity-60"
            >
              🔄 Tentar de novo
            </button>
          )}
        </div>
      )}
      {contagem > 0 && !erro && (
        <p className="text-sm text-text-soft">
          {contagem} foto{contagem > 1 ? "s" : ""} enviada{contagem > 1 ? "s" : ""} — pode continuar
          cadastrando peças no Mac.
        </p>
      )}
      <p className="text-xs text-text-soft">
        Deixe esta página aberta — as fotos aparecem sozinhas no formulário do Mac.
      </p>
    </main>
  );
}
