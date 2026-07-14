"use client";

export function BotaoImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white"
    >
      🖨️ Imprimir
    </button>
  );
}
