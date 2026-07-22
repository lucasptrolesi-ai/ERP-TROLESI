"use client";

export function BotaoImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
    >
      🖨️ Imprimir
    </button>
  );
}
