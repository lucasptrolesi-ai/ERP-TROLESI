export function KpiCard({
  label,
  valor,
  nota,
  tom = "rose",
}: {
  label: string;
  valor: string;
  nota: string;
  tom?: "rose" | "warn" | "crit" | "ok";
}) {
  const corValor =
    tom === "crit" ? "text-crit" : tom === "warn" ? "text-warn" : tom === "ok" ? "text-ok" : "text-rose-deep";
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${corValor}`}>{valor}</p>
      <p className="mt-0.5 text-xs text-text-soft">{nota}</p>
    </div>
  );
}
