"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { LeitorCameraModal } from "@/components/leitor-camera-modal";

/** Modal genérico só pra CAPTURAR um código (leitor USB, que "digita" o
 * código + Enter, ou câmera) e devolver pro chamador via onCodigo — quem
 * decide o que fazer com o código (abrir cadastro existente, abrir cadastro
 * novo já preenchido, etc.) é sempre a tela que usa este modal, não ele
 * mesmo. Reaproveitado tanto no PDV Eventos quanto no Estoque real. */
export function LeitorCodigoModal({
  aberto,
  onFechar,
  onCodigo,
  titulo = "Ler código de barras",
}: {
  aberto: boolean;
  onFechar: () => void;
  onCodigo: (codigo: string) => void;
  titulo?: string;
}) {
  const [codigo, setCodigo] = useState("");
  const [cameraAberta, setCameraAberta] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto && !cameraAberta) inputRef.current?.focus();
  }, [aberto, cameraAberta]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valor = codigo.trim();
    if (!valor) return;
    setCodigo("");
    onCodigo(valor);
  }

  return (
    <>
      <Modal aberto={aberto && !cameraAberta} onFechar={onFechar} titulo={titulo}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="codigo-leitor" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
              Código
            </label>
            <input
              ref={inputRef}
              id="codigo-leitor"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Bipe com o leitor USB ou digite"
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
            <p className="text-[0.7rem] text-text-soft">
              Com o leitor USB conectado, é só bipar — o campo já está pronto pra receber.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCameraAberta(true)}
            className="rounded-full border border-rose px-4 py-2.5 text-sm font-semibold text-rose-deep"
          >
            📷 Usar câmera
          </button>

          <button
            type="submit"
            disabled={!codigo.trim()}
            className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
          >
            Confirmar
          </button>
        </form>
      </Modal>

      {cameraAberta && (
        <LeitorCameraModal
          onCodigoLido={(codigoLido) => {
            onCodigo(codigoLido);
            return { sucesso: true, nomeProduto: "Código lido" };
          }}
          onFechar={() => setCameraAberta(false)}
        />
      )}
    </>
  );
}
