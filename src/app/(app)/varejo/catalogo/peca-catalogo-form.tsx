"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { CampoFotoProduto } from "@/components/campo-foto-produto";
import { CampoCodigoProduto } from "@/components/campo-codigo-produto";
import { cadastrarPecaCatalogo, editarPecaCatalogo } from "@/lib/actions/varejo";
import { formatarAtributos } from "@/lib/varejo/atributos";
import type { LinhaCatalogo } from "@/lib/varejo/tipos";

/** Cadastro de peça do catálogo Varejo, no mesmo sistema do PDV Eventos (pedido do usuário,
 * 2026-09-29): foto (arquivo local ou pareamento com a câmera do celular via QR) e código bipado
 * (leitor USB/câmera, sugerido automaticamente) — CampoFotoProduto/CampoCodigoProduto/
 * LeitorCodigoModal são os MESMOS componentes já usados lá, sem nada novo de visual. */
export function PecaCatalogoForm({
  aberto,
  onFechar,
  peca,
  skusExistentes,
  codigoInicial,
}: {
  aberto: boolean;
  onFechar: () => void;
  peca: LinhaCatalogo | null;
  skusExistentes: string[];
  // Preenche o campo Código numa peça NOVA (peca null) — usado pelo fluxo "ler código pra
  // cadastrar": o código já bipado vem pronto, só falta completar nome/preço/foto.
  codigoInicial?: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(formData: FormData) {
    setErro(null);
    const nome = String(formData.get("nome") ?? "").trim();
    const categoria = String(formData.get("categoria") ?? "").trim();
    const sku = String(formData.get("codigo_interno") ?? "").trim();
    const atributos = String(formData.get("atributos") ?? "").trim();
    const precoVenda = Number(String(formData.get("preco_venda") ?? "0").replace(",", "."));
    const precoMinimoTexto = String(formData.get("preco_minimo") ?? "").trim();
    const precoMinimo = precoMinimoTexto === "" ? null : Number(precoMinimoTexto.replace(",", "."));
    const ativo = formData.get("ativo") === "on";
    const arquivo = formData.get("foto");
    const arquivoFoto = arquivo instanceof File && arquivo.size > 0 ? arquivo : null;
    const fotoUrlAtual = String(formData.get("foto_url_atual") ?? "").trim() || null;

    iniciar(async () => {
      const resultado = peca
        ? await editarPecaCatalogo(
            peca.produto_id,
            peca.variacao_id,
            nome,
            categoria,
            sku,
            atributos,
            precoVenda,
            precoMinimo,
            arquivoFoto,
            fotoUrlAtual,
            ativo,
          )
        : await cadastrarPecaCatalogo(nome, categoria, sku, atributos, precoVenda, precoMinimo, arquivoFoto, fotoUrlAtual);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      onFechar();
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={peca ? "Editar peça" : "Nova peça"}>
      <form action={salvar} className="flex flex-col gap-4">
        <CampoFotoProduto fotoAtual={peca?.foto_url} prefixoCelular="varejo" />
        <CampoCodigoProduto
          defaultValue={peca?.sku ?? codigoInicial}
          codigosExistentes={skusExistentes}
          dica="Deixe em branco pra numerar automaticamente."
        />
        <FormField label="Nome" name="nome" defaultValue={peca?.produto_nome} required />
        <FormField label="Categoria (opcional)" name="categoria" defaultValue={peca?.categoria ?? undefined} />
        <FormField
          label="Atributos (opcional)"
          name="atributos"
          defaultValue={formatarAtributos(peca?.atributos)}
          semCaixaAlta
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Preço de venda (R$)"
            name="preco_venda"
            type="number"
            step="0.01"
            min={0}
            defaultValue={peca?.preco_venda}
            required
          />
          <FormField
            label="Preço mínimo (opcional)"
            name="preco_minimo"
            type="number"
            step="0.01"
            min={0}
            defaultValue={peca?.preco_minimo ?? undefined}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="ativo" defaultChecked={peca?.ativo ?? true} className="h-4 w-4 accent-rose" />
          Peça ativa (aparece pra venda)
        </label>

        {erro && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={pendente}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
        >
          {pendente ? "Salvando…" : "Salvar"}
        </button>
      </form>
    </Modal>
  );
}
