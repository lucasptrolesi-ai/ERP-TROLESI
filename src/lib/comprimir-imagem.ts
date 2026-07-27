const TAMANHO_MAXIMO_PX = 1600;
const QUALIDADE_JPEG = 0.8;

export type ImagemComprimida = { dataUrl: string; base64: string; mediaType: "image/jpeg" };

/**
 * Redimensiona pro maior lado caber em 1600px e recomprime como JPEG — poupa
 * banda no upload e no envio pra IA (fotos de câmera de celular costumam vir
 * com vários MB) sem perda perceptível de qualidade pra esse uso.
 */
export function comprimirImagem(file: File): Promise<ImagemComprimida> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, TAMANHO_MAXIMO_PX / Math.max(img.width, img.height));
      const largura = Math.round(img.width * escala);
      const altura = Math.round(img.height * escala);

      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Não foi possível processar a imagem."));
        return;
      }
      ctx.drawImage(img, 0, 0, largura, altura);

      const dataUrl = canvas.toDataURL("image/jpeg", QUALIDADE_JPEG);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}
