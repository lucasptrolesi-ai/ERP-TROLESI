import type { SupabaseClient } from "@supabase/supabase-js";

// Compartilhado entre salvarProduto (Estoque real) e salvarProdutoEvento
// (PDV Eventos) — os dois sobem pro mesmo bucket produtos-fotos, só o
// prefixo do caminho muda, pra não misturar as duas origens dentro do
// mesmo bucket.
export async function subirFotoProduto(
  supabase: SupabaseClient,
  arquivo: File,
  prefixo: "manual" | "evento",
): Promise<{ url?: string; erro?: string }> {
  const extensao = arquivo.type === "image/png" ? "png" : "jpg";
  const caminho = `${prefixo}/${crypto.randomUUID()}.${extensao}`;
  const bytes = new Uint8Array(await arquivo.arrayBuffer());

  const { error } = await supabase.storage
    .from("produtos-fotos")
    .upload(caminho, bytes, { contentType: arquivo.type || "image/jpeg" });
  if (error) return { erro: "Não foi possível enviar a foto. Tente novamente." };

  const { data } = supabase.storage.from("produtos-fotos").getPublicUrl(caminho);
  return { url: data.publicUrl };
}

/** Extrai o arquivo de foto do FormData, se um foi realmente escolhido
 * (inputs de arquivo vazios ainda chegam como File de tamanho 0). */
export function fotoEscolhida(formData: FormData): File | null {
  const arquivo = formData.get("foto");
  return arquivo instanceof File && arquivo.size > 0 ? arquivo : null;
}
