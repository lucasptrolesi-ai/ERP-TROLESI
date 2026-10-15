import type { ElementoEtiqueta } from "@/lib/etiquetas/zpl";

/** Miniatura aproximada do modelo (não é o ZPL de verdade, só layout) — cada elemento posicionado em
 * percentual (x_mm/w_mm sobre a largura do modelo, idem altura), igual um "mapa" da etiqueta. Texto
 * fixo mostra o próprio texto; texto ligado a campo mostra "[nome do campo]" (não busca dado de peça
 * nenhuma aqui — isso é só a tela de Modelos/Lote decidindo rápido qual modelo escolher, não uma
 * prova de impressão). QR/código de barras viram um ícone quadriculado genérico. */
export function PreviaModelo({ largura_mm, altura_mm, elementos }: { largura_mm: number; altura_mm: number; elementos: ElementoEtiqueta[] }) {
  return (
    <div className="relative w-full overflow-hidden rounded-md border border-line bg-surface" style={{ aspectRatio: `${largura_mm} / ${altura_mm}` }}>
      {elementos.map((el) => {
        const posicao: React.CSSProperties = {
          position: "absolute",
          left: `${(el.x_mm / largura_mm) * 100}%`,
          top: `${(el.y_mm / altura_mm) * 100}%`,
          width: `${(el.w_mm / largura_mm) * 100}%`,
          height: `${(el.h_mm / altura_mm) * 100}%`,
        };

        if (el.tipo === "qr" || el.tipo === "barcode") {
          return (
            <div
              key={el.id}
              style={{ ...posicao, backgroundImage: "repeating-conic-gradient(#2c2520 0% 25%, transparent 0% 50%)", backgroundSize: "28% 28%" }}
            />
          );
        }

        if (el.tipo === "texto") {
          const texto = el.conteudo?.origem === "fixo" ? el.conteudo.texto : `[${el.conteudo?.campo ?? "campo"}]`;
          const justify = el.alinhamento === "centro" ? "center" : el.alinhamento === "direita" ? "flex-end" : "flex-start";
          return (
            <div
              key={el.id}
              style={{ ...posicao, display: "flex", alignItems: "center", justifyContent: justify }}
              className="overflow-hidden whitespace-nowrap text-[0.45rem] font-semibold leading-none text-ink"
            >
              {texto}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
