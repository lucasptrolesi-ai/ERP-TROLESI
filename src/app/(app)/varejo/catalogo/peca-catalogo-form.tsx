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
  depositoId,
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
  // Depósito da loja (Varejo só tem um, "LOJA") — usado pra lançar a entrada de estoque quando
  // "Veio do Atacado?" está ligado. Sem isso, o toggle não tem como registrar a compra.
  depositoId?: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  // "Veio do Atacado?" (pedido do dono, 2026-10-09): ele digita o código do Atacado (ex: 8,4) em vez
  // de usar a transferência formal — o sistema calcula custo/preço sugerido/mínimo sozinho e, ao
  // salvar, lança a entrada de estoque + a dívida com o Atacado (pago/em aberto). Só faz sentido
  // cadastrando peça NOVA (não editando) e só pro admin (calculadora nunca vem pro perfil estoque).
  const permiteAtacado = !peca && !!calculadora;
  const [veioDoAtacado, setVeioDoAtacado] = useState(false);
  const [codigoTexto, setCodigoTexto] = useState("");
  const [quantidadeTexto, setQuantidadeTexto] = useState("1");
  const [statusDivida, setStatusDivida] = useState<"em_aberto" | "pago">("em_aberto");
  // Controlados só quando permiteAtacado (peça nova + admin) — edição de peça existente continua
  // 100% como antes (defaultValue, não-controlado), sem nenhuma mudança de comportamento.
  const [precoVendaTexto, setPrecoVendaTexto] = useState("");
  const [precoMinimoTexto, setPrecoMinimoTexto] = useState("");

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
  // depois, o valor dele fica até o código mudar de novo (não reaplica a cada render).
  const chaveAutoPreenchimento = `${veioDoAtacado}:${codigo}`;
  const [chaveAnterior, setChaveAnterior] = useState(chaveAutoPreenchimento);
  if (chaveAutoPreenchimento !== chaveAnterior) {
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

    let quantidadeAtacado = 0;
    if (permiteAtacado && veioDoAtacado) {
      if (codigo === null) {
        setErro("Informe o código do Atacado (maior que zero).");
        return;
      }
      if (!depositoId) {
        setErro("Nenhum depósito ativo encontrado para o Varejo.");
        return;
      }
      quantidadeAtacado = Number(quantidadeTexto);
      if (!Number.isInteger(quantidadeAtacado) || quantidadeAtacado <= 0) {
        setErro("Informe uma quantidade válida.");
        return;
      }
    }

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
            permiteAtacado && veioDoAtacado && codigo !== null && depositoId
              ? { codigoAtacado: codigo, quantidade: quantidadeAtacado, status: statusDivida, depositoId }
              : null,
          );
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

        {permiteAtacado && (
          <label className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-cream px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={veioDoAtacado}
              onChange={(e) => setVeioDoAtacado(e.target.checked)}
              className="h-4 w-4 accent-rose"
            />
            Veio do Atacado? (calcula o preço pelo código e lança a dívida)
          </label>
        )}

        {permiteAtacado && veioDoAtacado && calculadora && (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line bg-cream p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Código do Atacado</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={codigoTexto}
                  onChange={(e) => setCodigoTexto(e.target.value)}
                  placeholder="Ex: 10"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Quantidade</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={quantidadeTexto}
                  onChange={(e) => setQuantidadeTexto(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
                />
              </label>
            </div>
            {codigo != null && custo != null && (
              <p className="text-xs text-text-soft">
                Custo <strong className="text-ink">{formatarMoeda(custo)}</strong> · Piso de prejuízo{" "}
                <strong className="text-crit">{piso != null && Number.isFinite(piso) ? formatarMoeda(piso) : "—"}</strong>
              </p>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Pagamento ao Atacado</span>
              <select
                value={statusDivida}
                onChange={(e) => setStatusDivida(e.target.value as "em_aberto" | "pago")}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <option value="em_aberto">Em aberto</option>
                <option value="pago">Já paguei</option>
              </select>
            </label>
            <p className="text-[0.65rem] text-text-soft">
              Preço de venda e mínimo abaixo já saem preenchidos a partir do código — você ainda pode ajustar antes de salvar.
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
