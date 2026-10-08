"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { CampoFotoProduto } from "@/components/campo-foto-produto";
import { CampoCodigoProduto } from "@/components/campo-codigo-produto";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { cadastrarPecaCatalogo, editarPecaCatalogo } from "@/lib/actions/varejo";
import { formatarAtributos } from "@/lib/varejo/atributos";
import { calcularCusto, calcularPisoDePrejuizo, calcularPrecoMinimo, calcularPrecoSugerido } from "@/lib/varejo/financeiro";
import type { LinhaCatalogo } from "@/lib/varejo/tipos";
import type { CalculadoraPreco } from "./page";

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
  calculadora,
}: {
  aberto: boolean;
  onFechar: () => void;
  peca: LinhaCatalogo | null;
  skusExistentes: string[];
  // Preenche o campo Código numa peça NOVA (peca null) — usado pelo fluxo "ler código pra
  // cadastrar": o código já bipado vem pronto, só falta completar nome/preço/foto.
  codigoInicial?: string;
  // Controle Financeiro do Varejo, Fase 5 — só vem preenchido pro admin (nunca pro perfil estoque,
  // que também cadastra peça nesta tela, mas não deve ver custo/margem).
  calculadora?: CalculadoraPreco;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(formData: FormData) {
    setErro(null);
    const nome = String(formData.get("nome") ?? "").trim();
    const categoria = String(formData.get("categoria") ?? "").trim();
    const sku = String(formData.get("codigo_interno") ?? "").trim();
    const atributos = String(formData.get("atributos") ?? "").trim();
    const localizacao = String(formData.get("localizacao") ?? "").trim();
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
            localizacao,
          )
        : await cadastrarPecaCatalogo(nome, categoria, sku, atributos, precoVenda, precoMinimo, arquivoFoto, fotoUrlAtual, localizacao);
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
        <FormField
          label="Localização (opcional)"
          name="localizacao"
          defaultValue={formatarAtributos(peca?.localizacao)}
          semCaixaAlta
        />
        <p className="-mt-2 text-[0.7rem] text-text-soft">Ex: carrinho 1, gaveta 2, bandeja 1, gancho 8</p>

        {calculadora && <CalculadoraDePreco calculadora={calculadora} />}

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

/** Calculadora de apoio (Controle Financeiro do Varejo, Fase 5): o "código" do Atacado (número que já
 * define custo/preço lá) não é um campo salvo aqui — é só uma conta rápida pra saber quanto cobrar
 * antes de preencher o preço de venda acima. Não muda nada sozinho; o dono sempre decide e digita o
 * preço final nos campos de verdade. */
function CalculadoraDePreco({ calculadora }: { calculadora: CalculadoraPreco }) {
  const [codigoTexto, setCodigoTexto] = useState("");
  const codigo = Number(codigoTexto.replace(",", "."));
  const valido = codigoTexto.trim() !== "" && Number.isFinite(codigo) && codigo > 0;

  const { config, fatorCusto, markupMinimo } = calculadora;
  const custo = valido ? calcularCusto(codigo, fatorCusto) : null;
  const sugerido = valido ? calcularPrecoSugerido(codigo, config.fator_venda_padrao, config.preco_piso_entrada, config.arredondar_90) : null;
  const piso = custo != null ? calcularPisoDePrejuizo(custo, config.despesas_variaveis_pct) : null;
  const minimo = custo != null && markupMinimo.viavel ? calcularPrecoMinimo(custo, markupMinimo.markup) : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-cream p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Calculadora — código do Atacado (opcional)</span>
        <input
          type="text"
          inputMode="decimal"
          value={codigoTexto}
          onChange={(e) => setCodigoTexto(e.target.value)}
          placeholder="Ex: 10"
          className="w-32 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
      </label>
      {valido && custo != null && (
        <p className="text-xs text-text-soft">
          Custo <strong className="text-ink">{formatarMoeda(custo)}</strong> · Sugerido{" "}
          <strong className="text-ink">{sugerido != null ? formatarMoeda(sugerido) : "—"}</strong> · Mínimo{" "}
          <strong className="text-ink">{minimo != null ? formatarMoeda(minimo) : "inviável com os parâmetros atuais"}</strong> · Piso de prejuízo{" "}
          <strong className="text-crit">{piso != null ? formatarMoeda(piso) : "—"}</strong>
        </p>
      )}
      <p className="text-[0.65rem] text-text-soft">Só uma conta de apoio — não preenche nem trava nada sozinho. Digite o preço de verdade abaixo.</p>
    </div>
  );
}
