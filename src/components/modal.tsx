"use client";

import { useEffect, useRef } from "react";

export function Modal({
  aberto,
  onFechar,
  titulo,
  children,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      onClose={onFechar}
      className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
        <h2 className="font-display text-lg font-semibold">{titulo}</h2>
        <button
          type="button"
          onClick={onFechar}
          className="text-text-soft hover:text-ink"
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
