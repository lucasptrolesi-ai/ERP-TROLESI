"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { CampoFotoProduto } from "@/components/campo-foto-produto";
import { CampoCodigoProduto } from "@/components/campo-codigo-produto";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { lerMoeda } from "@/lib/dinheiro";
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
  onPecaCriada,
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
  // Chamado só numa peça NOVA (nunca editando), depois de salvar com sucesso — abre a tela
  // "Imprimir etiqueta" (catalogo-varejo-view.tsx) com os dados que acabaram de ser gravados.
  onPecaCriada?: (dados: {
    produtoId: string;
    variacaoId: string;
    sku: string;
    nomeProduto: string;
    categoria: string | null;
    atributosTexto: string;
    precoVenda: number;
    quantidadeEstoque: number | null;
  }) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  // "Veio do Atacado?" (pedido do dono, 2026-10-09; revisão 2026-10-26): ele digita o código do
  // Atacado (ex: 8,4) em vez de usar a transferência formal — o sistema calcula custo/preço
  // sugerido/mínimo sozinho pra ajudar a decidir o preço. Desde 2026-10-26 o código só fica salvo
  // como metadado da peça -- NÃO lança mais entrada de estoque nem dívida aqui (a dívida só nasce
  // quando a peça VENDE, ver DECISIONS.md); por isso agora também faz sentido numa peça já
  // existente (editar pra adicionar/corrigir o código), não só numa peça nova. Só pro admin
  // (calculadora nunca vem pro perfil estoque).
  const permiteAtacado = !!calculadora;
  const [veioDoAtacado, setVeioDoAtacado] = useState(!!peca?.codigo_atacado);
  const [codigoTexto, setCodigoTexto] = useState(peca?.codigo_atacado != null ? peca.codigo_atacado.toFixed(2).replace(".", ",") : "");
  // Controlados quando permiteAtacado (admin) — preenchidos a partir da peça quando editando, pra
  // não perder o valor já salvo (o toggle/código acima só reaproveita os MESMOS campos de preço,
  // nunca duplica).
  const [precoVendaTexto, setPrecoVendaTexto] = useState(peca ? peca.preco_venda.toFixed(2).replace(".", ",") : "");
  const [precoMinimoTexto, setPrecoMinimoTexto] = useState(peca?.preco_minimo != null ? peca.preco_minimo.toFixed(2).replace(".", ",") : "");

  const lido = lerMoeda(codigoTexto);
  const codigo = lido !== null && lido > 0 ? lido : null;
  const custo = calculadora && codigo !== null ? calcularCusto(codigo, calculadora.fatorCusto) : null;
  const sugerido =
    calculadora && codigo !== null
      ? calcularPrecoSugerido(codigo, calculadora.config.fator_venda_padrao, calculadora.config.preco_piso_entrada, calculadora.config.arredondar_90)
      : null;
  const piso = custo != null && calculadora ? calcularPisoDePrejuizo(custo, calculadora.config.despesas_variaveis_pct) : null;
  const minimo = custo != null && calculadora?.markupMinimo.viavel ? calcularPrecoMinimo(custo, calculadora.markupMinimo.markup) : null;

  // Preenche o sugerido/mínimo toda vez que o código (ou o toggle) muda -- ajuste de estado durante
  // a própria renderização (padrão recomendado pelo React pra "derivar estado a partir de uma prop",
  // sem useEffect: https://react.dev/learn/you-might-not-need-an-effect). Se o dono digitar por cima
  // depois, o valor dele fica até o código mudar de novo (não reaplica a cada render). Só numa peça
  // NOVA (!peca) -- editando uma peça existente, o código serve pra salvar o metadado, mas nunca
  // sobrescreve um preço que o dono já tinha definido com cuidado antes.
  const chaveAutoPreenchimento = `${veioDoAtacado}:${codigo}`;
  const [chaveAnterior, setChaveAnterior] = useState(chaveAutoPreenchimento);
  if (!peca && chaveAutoPreenchimento !== chaveAnterior) {
    setChaveAnterior(chaveAutoPreenchimento);
    if (veioDoAtacado) {
      setPrecoVendaTexto(sugerido != null ? sugerido.toFixed(2) : "");
      setPrecoMinimoTexto(minimo != null ? minimo.toFixed(2) : "");
    }
  }

  function salvar(formData: FormData) {
    setErro(null);
    const nome = String(formData.get("nome") ?? "").trim();
    const categoria = String(formData.get("categoria") ?? "").trim();
    const sku = String(formData.get("codigo_interno") ?? "").trim();
    const atributos = String(formData.get("atributos") ?? "").trim();
    const localizacao = String(formData.get("localizacao") ?? "").trim();
    const precoVenda = Number(String(formData.get("preco_venda") ?? "0").replace(",", "."));
    const precoMinimoCampo = String(formData.get("preco_minimo") ?? "").trim();
    const precoMinimo = precoMinimoCampo === "" ? null : Number(precoMinimoCampo.replace(",", "."));
    const ativo = formData.get("ativo") === "on";
    const arquivo = formData.get("foto");
    const arquivoFoto = arquivo instanceof File && arquivo.size > 0 ? arquivo : null;
    const fotoUrlAtual = String(formData.get("foto_url_atual") ?? "").trim() || null;

    if (permiteAtacado && veioDoAtacado && codigo === null) {
      setErro("Informe o código do Atacado (maior que zero).");
      return;
    }
    // Metadado só (2026-10-26) -- nunca mais entrada de estoque nem dívida aqui. null quando o
    // toggle está desligado (inclusive editando: desligar remove o código salvo na peça).
    const codigoAtacado = permiteAtacado && veioDoAtacado && codigo !== null ? codigo : null;

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
            codigoAtacado,
          )
        : await cadastrarPecaCatalogo(
            nome,
            categoria,
            sku,
            atributos,
            precoVenda,
            precoMinimo,
            arquivoFoto,
            fotoUrlAtual,
            localizacao,
            codigoAtacado,
          );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      if (!peca && resultado.produtoId && resultado.variacaoId) {
        onPecaCriada?.({
          produtoId: resultado.produtoId,
          variacaoId: resultado.variacaoId,
          // sku em branco vira numeração automática no banco — o valor de verdade (o que o PDV bipa)
          // é o que cadastrarPecaCatalogo devolve, não necessariamente o que foi digitado aqui.
          sku: resultado.sku ?? sku,
          nomeProduto: nome,
          categoria: categoria || null,
          atributosTexto: atributos,
          precoVenda,
          // Cadastro nunca lança entrada de estoque (2026-10-26) -- quem imprime etiqueta decide a
          // quantidade na hora, sem sugestão nenhuma.
          quantidadeEstoque: null,
        });
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

        {permiteAtacado && (
          <label className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-cream px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={veioDoAtacado}
              onChange={(e) => setVeioDoAtacado(e.target.checked)}
              className="h-4 w-4 accent-rose"
            />
            Veio do Atacado? (calcula o preço pelo código — a dívida só é lançada quando a peça vender)
          </label>
        )}

        {permiteAtacado && veioDoAtacado && calculadora && (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line bg-cream p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Código do Atacado</span>
              <input
                type="text"
                inputMode="decimal"
                value={codigoTexto}
                onChange={(e) => setCodigoTexto(e.target.value)}
                placeholder="Ex: 10"
                className="w-32 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
              />
            </label>
            {codigo != null && custo != null && (
              <p className="text-xs text-text-soft">
                Custo <strong className="text-ink">{formatarMoeda(custo)}</strong> · Piso de prejuízo{" "}
                <strong className="text-crit">{piso != null && Number.isFinite(piso) ? formatarMoeda(piso) : "—"}</strong>
              </p>
            )}
            <p className="text-[0.65rem] text-text-soft">
              {peca
                ? "Alterar o código não afeta vendas já feitas — só passa a valer nas próximas."
                : "Preço de venda e mínimo abaixo já saem preenchidos a partir do código — você ainda pode ajustar antes de salvar."}
            </p>
          </div>
        )}

        {calculadora && !veioDoAtacado && <CalculadoraDePreco calculadora={calculadora} />}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Preço de venda (R$)"
            name="preco_venda"
            type="number"
            step="0.01"
            min={0}
            defaultValue={permiteAtacado ? undefined : peca?.preco_venda}
            value={permiteAtacado ? precoVendaTexto : undefined}
            onChange={permiteAtacado ? (e) => setPrecoVendaTexto(e.target.value) : undefined}
            required
          />
          <FormField
            label="Preço mínimo (opcional)"
            name="preco_minimo"
            type="number"
            step="0.01"
            min={0}
            defaultValue={permiteAtacado ? undefined : peca?.preco_minimo ?? undefined}
            value={permiteAtacado ? precoMinimoTexto : undefined}
            onChange={permiteAtacado ? (e) => setPrecoMinimoTexto(e.target.value) : undefined}
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
 * preço final nos campos de verdade. Só aparece quando "Veio do Atacado?" está desligado (ou em
 * edição, onde o toggle nem existe) — com o toggle ligado, o bloco acima já faz o preenchimento. */
function CalculadoraDePreco({ calculadora }: { calculadora: CalculadoraPreco }) {
  const [codigoTexto, setCodigoTexto] = useState("");
  // Mesmo parser de número usado no resto do app (lerMoeda) — não um Number() cru: "1.200" tem que
  // virar 1200, não 1.2 (mesma ambiguidade de separador de milhar que lerMoeda já resolve).
  const lido = lerMoeda(codigoTexto);
  const codigo = lido !== null && lido > 0 ? lido : null;
  const valido = codigo !== null;

  const { config, fatorCusto, markupMinimo } = calculadora;
  const custo = codigo !== null ? calcularCusto(codigo, fatorCusto) : null;
  const sugerido = codigo !== null ? calcularPrecoSugerido(codigo, config.fator_venda_padrao, config.preco_piso_entrada, config.arredondar_90) : null;
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
          <strong className="text-crit">{piso != null && Number.isFinite(piso) ? formatarMoeda(piso) : "—"}</strong>
        </p>
      )}
      <p className="text-[0.65rem] text-text-soft">Só uma conta de apoio — não preenche nem trava nada sozinho. Digite o preço de verdade abaixo.</p>
    </div>
  );
}
