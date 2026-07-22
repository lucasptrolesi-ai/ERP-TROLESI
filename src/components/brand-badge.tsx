const VARIANTES = {
  gold: "bg-gradient-to-br from-gold-start to-gold-end text-gold-ink",
  rose: "bg-gradient-to-br from-gold-start to-gold-end text-gold-ink",
};

export function BrandBadge({
  children,
  variant,
  size = "md",
}: {
  children: React.ReactNode;
  variant: keyof typeof VARIANTES;
  size?: "md" | "lg";
}) {
  const tamanho = size === "lg" ? "h-12 w-12 text-xl" : "h-9 w-9 text-base";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-display font-bold ${tamanho} ${VARIANTES[variant]}`}
    >
      {children}
    </div>
  );
}
