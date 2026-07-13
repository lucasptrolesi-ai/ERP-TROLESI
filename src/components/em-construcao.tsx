export function EmConstrucao({ titulo }: { titulo: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-2xl font-semibold text-ink">{titulo}</h1>
      <p className="text-sm text-text-soft">
        Módulo ainda não implementado — chega na Fase 4 do plano, um módulo de cada vez.
      </p>
    </div>
  );
}
