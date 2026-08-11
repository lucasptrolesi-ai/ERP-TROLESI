"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import { comprimirImagem } from "@/lib/comprimir-imagem";
import { analisarFotosProduto, buscarProdutosSemelhantes, salvarProdutoComIA } from "@/lib/actions/vision-ai";
import type { AnaliseIaProduto, ProdutoSemelhante } from "@/lib/types";

type TipoSlot = "frente" | "verso" | "detalhe";
type SlotFoto = { dataUrl: string; base64: string; mediaType: "image/jpeg" };
type Correcao = { campo: string; valor_sugerido: string | null; valor_corrigido: string };

const CAMPOS_TEXTO: (keyof AnaliseIaProduto)[] = [
  "nome",
  "categoria",
  "subcategoria",
  "material",
  "cor",
  "tipo_banho",
  "tamanho",
  "colecao",
  "descricao",
];

const CAMPOS_BOOLEANOS: (keyof AnaliseIaProduto)[] = ["tem_pedra", "tem_perola"];

function diffAnalise(original: AnaliseIaProduto, editado: AnaliseIaProduto): Correcao[] {
  const correcoes: Correcao[] = [];
  for (const campo of CAMPOS_TEXTO) {
    const antes = original[campo];
    const depois = editado[campo];
    if ((antes ?? "") !== (depois ?? "") && depois) {
      correcoes.push({ campo, valor_sugerido: (antes as string | null) ?? null, valor_corrigido: depois as string });
    }
  }
  for (const campo of CAMPOS_BOOLEANOS) {
    const antes = original[campo] as boolean;
    const depois = editado[campo] as boolean;
    if (antes !== depois) {
      correcoes.push({ campo, valor_sugerido: String(antes), valor_corrigido: String(depois) });
    }
  }
  const tagsAntes = (original.tags ?? []).join(", ");
  const tagsDepois = (editado.tags ?? []).join(", ");
  if (tagsAntes !== tagsDepois) {
    correcoes.push({ campo: "tags", valor_sugerido: tagsAntes || null, valor_corrigido: tagsDepois });
  }
  return correcoes;
}

function CampoTexto({
  label,
  valor,
  onChange,
  textarea,
}: {
  label: string;
  valor: string;
  onChange: (valor: string) => void;
  textarea?: boolean;
}) {
  // Mesma convenção de caixa alta do resto do sistema desde 2026-07-25 (ver
  // src/components/form-field.tsx) — a revisão da IA também é texto digitado
  // (editável) e não seguia o padrão. Preserva a posição do cursor, senão
  // setar `.value` manualmente jogaria o cursor pro fim a cada tecla.
  function aoMudar(evento: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const posicaoCursor = evento.target.selectionStart;
    const valorMaiusculo = evento.target.value.toUpperCase();
    evento.target.value = valorMaiusculo;
    if (posicaoCursor !== null) evento.target.setSelectionRange(posicaoCursor, posicaoCursor);
    onChange(valorMaiusculo);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-soft">
        {label}
        <span className="rounded-full bg-rose-soft px-2 py-0.5 text-[0.6rem] font-extrabold uppercase text-rose-deep">
          IA
        </span>
      </label>
      {textarea ? (
        <textarea
          value={valor}
          onChange={aoMudar}
          rows={3}
          style={{ textTransform: "uppercase" }}
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
        />
      ) : (
        <input
          value={valor}
          onChange={aoMudar}
          style={{ textTransform: "uppercase" }}
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
        />
      )}
    </div>
  );
}

function CampoBooleano({
  label,
  valor,
  onChange,
}: {
  label: string;
  valor: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-rose"
      />
      {label}
      <span className="rounded-full bg-rose-soft px-2 py-0.5 text-[0.6rem] font-extrabold uppercase text-rose-deep">
        IA
      </span>
    </label>
  );
}

function QuadroFoto({
  tipo,
  rotulo,
  obrigatoria,
  foto,
  onSelecionar,
}: {
  tipo: TipoSlot;
  rotulo: string;
  obrigatoria?: boolean;
  foto: SlotFoto | null;
  onSelecionar: (tipo: TipoSlot, foto: SlotFoto) => void;
}) {
  const [carregando, setCarregando] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setCarregando(true);
    try {
      const comprimida = await comprimirImagem(arquivo);
      onSelecionar(tipo, comprimida);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <label
      className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 text-center ${
        foto
          ? "border-transparent bg-gradient-to-br from-rose-soft to-gold-end"
          : "cursor-pointer border-dashed border-line bg-cream"
      }`}
    >
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      {carregando ? (
        <span className="text-xs font-semibold text-text-soft">Carregando…</span>
      ) : foto ? (
        // eslint-disable-next-line @next/next/no-img-element -- prévia local (data URL), não é foto do catálogo
        <img src={foto.dataUrl} alt={rotulo} className="h-full w-full rounded-2xl object-cover" />
      ) : (
        <>
          <span className="text-[0.7rem] font-bold uppercase tracking-wide text-text-soft">{rotulo}</span>
          <span className="text-[0.65rem] font-bold text-rose-deep">
            {obrigatoria ? "obrigatória" : "opcional"}
          </span>
        </>
      )}
    </label>
  );
}

export function CadastroIaView() {
  const router = useRouter();
  const [passo, setPasso] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [fotos, setFotos] = useState<Record<TipoSlot, SlotFoto | null>>({
    frente: null,
    verso: null,
    detalhe: null,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [analisando, iniciarAnalise] = useTransition();
  const [analiseOriginal, setAnaliseOriginal] = useState<AnaliseIaProduto | null>(null);
  const [analiseEditada, setAnaliseEditada] = useState<AnaliseIaProduto | null>(null);
  const [codigoPeca, setCodigoPeca] = useState("");
  const [semelhantes, setSemelhantes] = useState<ProdutoSemelhante[]>([]);
  const [buscandoSemelhantes, iniciarBusca] = useTransition();
  const [salvando, iniciarSalvar] = useTransition();
  const [resultado, setResultado] = useState<{
    codigoInterno: string;
    nome: string;
    avisoFotos?: string;
  } | null>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // O código de barras impresso é o próprio código interno (já é a busca
    // rápida tipo PDV) — não existe uma coluna separada gerada pra isso.
    if (resultado && barcodeRef.current) {
      JsBarcode(barcodeRef.current, resultado.codigoInterno, {
        format: "CODE128",
        displayValue: true,
        height: 50,
        margin: 4,
      });
    }
  }, [resultado]);

  function handleSelecionarFoto(tipo: TipoSlot, foto: SlotFoto) {
    setFotos((atual) => ({ ...atual, [tipo]: foto }));
  }

  function atualizarCampo(campo: keyof AnaliseIaProduto, valor: string) {
    setAnaliseEditada((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  function atualizarBooleano(campo: "tem_pedra" | "tem_perola", valor: boolean) {
    setAnaliseEditada((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  function handleAnalisar() {
    if (!fotos.frente) {
      setErro("A foto da frente é obrigatória.");
      return;
    }
    setErro(null);
    setPasso(2);
    iniciarAnalise(async () => {
      const entrada = (["frente", "verso", "detalhe"] as TipoSlot[])
        .filter((tipo) => fotos[tipo])
        .map((tipo) => ({ tipo, base64: fotos[tipo]!.base64, mediaType: fotos[tipo]!.mediaType }));

      const resposta = await analisarFotosProduto(entrada);
      if (resposta.erro || !resposta.resultado) {
        setErro(resposta.erro ?? "Não foi possível analisar as fotos.");
        setPasso(1);
        return;
      }
      setAnaliseOriginal(resposta.resultado);
      setAnaliseEditada(resposta.resultado);
      setPasso(3);
    });
  }

  function handleContinuarRevisao() {
    if (!analiseEditada) return;
    const valor = Number(codigoPeca.trim().replace(",", "."));
    if (!codigoPeca.trim() || !Number.isFinite(valor) || valor <= 0) {
      setErro("Informe um código da peça válido (número maior que zero).");
      return;
    }
    setErro(null);
    iniciarBusca(async () => {
      const parecidos = await buscarProdutosSemelhantes(analiseEditada);
      setSemelhantes(parecidos);
      setPasso(4);
    });
  }

  function handleConfirmarCadastro() {
    if (!analiseOriginal || !analiseEditada) return;
    setErro(null);
    iniciarSalvar(async () => {
      const imagens = (["frente", "verso", "detalhe"] as TipoSlot[])
        .filter((tipo) => fotos[tipo])
        .map((tipo) => ({ tipo, base64: fotos[tipo]!.base64, mediaType: fotos[tipo]!.mediaType }));

      const resposta = await salvarProdutoComIA({
        analise: analiseEditada,
        codigoPeca: Number(codigoPeca.replace(",", ".")) || 0,
        imagens,
        correcoes: diffAnalise(analiseOriginal, analiseEditada),
      });

      if (resposta.erro || !resposta.codigoInterno) {
        setErro(resposta.erro ?? "Não foi possível salvar o produto.");
        return;
      }
      setResultado({
        codigoInterno: resposta.codigoInterno,
        nome: analiseEditada.nome,
        avisoFotos: resposta.avisoFotos,
      });
      setPasso(5);
    });
  }

  const etapas = ["Captura", "Análise", "Revisão", "Duplicidade", "Confirmação"];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <span className="text-[0.7rem] font-bold uppercase tracking-wide text-rose-deep">
            Estoque · Trolesi Vision AI
          </span>
          <h1 className="font-display text-2xl font-semibold text-ink">Cadastro de produto por foto</h1>
        </div>
        <Link href="/estoque" className="text-sm font-semibold text-text-soft hover:text-ink">
          ← Voltar
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-5 gap-1 print:hidden">
        {etapas.map((nome, i) => (
          <div key={nome} className="flex flex-col items-center gap-1.5">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                passo === i + 1
                  ? "bg-gradient-to-br from-gold-start to-gold-end text-gold-ink"
                  : "border border-line bg-surface text-text-soft"
              }`}
            >
              {i + 1}
            </div>
            <span className="hidden text-[0.62rem] font-bold uppercase text-text-soft sm:block">{nome}</span>
          </div>
        ))}
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-5 shadow-sm print:border-none print:p-0 print:shadow-none">
        {erro && (
          <p role="alert" className="mb-4 rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit print:hidden">
            {erro}
          </p>
        )}

        {passo === 1 && (
          <div className="print:hidden">
            <h2 className="mb-1 text-lg font-semibold text-ink">Fotografe a peça</h2>
            <p className="mb-4 text-sm text-text-soft">
              Frente é obrigatória. Verso e detalhe ajudam a IA a identificar pedras, acabamento e fecho.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <QuadroFoto tipo="frente" rotulo="Frente" obrigatoria foto={fotos.frente} onSelecionar={handleSelecionarFoto} />
              <QuadroFoto tipo="verso" rotulo="Verso" foto={fotos.verso} onSelecionar={handleSelecionarFoto} />
              <QuadroFoto tipo="detalhe" rotulo="Detalhe" foto={fotos.detalhe} onSelecionar={handleSelecionarFoto} />
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={handleAnalisar}
                disabled={!fotos.frente}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-50"
              >
                Analisar com IA →
              </button>
            </div>
          </div>
        )}

        {passo === 2 && (
          <div className="flex flex-col items-center gap-4 py-8 text-center print:hidden">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-rose-soft border-t-rose-deep" />
            <p className="text-sm font-semibold text-ink">
              {analisando ? "Analisando as fotos…" : "Quase lá…"}
            </p>
            <p className="text-xs text-text-soft">Identificando categoria, material, cor, pedra e gerando a descrição.</p>
          </div>
        )}

        {passo === 3 && analiseEditada && (
          <div className="print:hidden">
            <h2 className="mb-1 text-lg font-semibold text-ink">Confirme os dados</h2>
            <p className="mb-4 text-sm text-text-soft">Tudo abaixo veio da IA e pode ser editado antes de salvar.</p>

            <div className="flex flex-col gap-4">
              <CampoTexto label="Nome comercial" valor={analiseEditada.nome} onChange={(v) => atualizarCampo("nome", v)} />
              <div className="grid grid-cols-2 gap-3">
                <CampoTexto label="Categoria" valor={analiseEditada.categoria} onChange={(v) => atualizarCampo("categoria", v)} />
                <CampoTexto
                  label="Subcategoria"
                  valor={analiseEditada.subcategoria ?? ""}
                  onChange={(v) => atualizarCampo("subcategoria", v)}
                />
                <CampoTexto label="Material" valor={analiseEditada.material ?? ""} onChange={(v) => atualizarCampo("material", v)} />
                <CampoTexto label="Tipo de banho" valor={analiseEditada.tipo_banho ?? ""} onChange={(v) => atualizarCampo("tipo_banho", v)} />
                <CampoTexto label="Cor" valor={analiseEditada.cor ?? ""} onChange={(v) => atualizarCampo("cor", v)} />
                <CampoTexto label="Tamanho" valor={analiseEditada.tamanho ?? ""} onChange={(v) => atualizarCampo("tamanho", v)} />
              </div>
              <div className="flex gap-4">
                <CampoBooleano
                  label="Tem pedra"
                  valor={analiseEditada.tem_pedra}
                  onChange={(v) => atualizarBooleano("tem_pedra", v)}
                />
                <CampoBooleano
                  label="Tem pérola"
                  valor={analiseEditada.tem_perola}
                  onChange={(v) => atualizarBooleano("tem_perola", v)}
                />
              </div>
              <CampoTexto label="Coleção" valor={analiseEditada.colecao ?? ""} onChange={(v) => atualizarCampo("colecao", v)} />
              <CampoTexto
                label="Descrição"
                valor={analiseEditada.descricao}
                onChange={(v) => atualizarCampo("descricao", v)}
                textarea
              />
              <CampoTexto
                label="Tags (separadas por vírgula)"
                valor={(analiseEditada.tags ?? []).join(", ")}
                onChange={(v) =>
                  setAnaliseEditada((atual) =>
                    atual ? { ...atual, tags: v.split(",").map((t) => t.trim()).filter(Boolean) } : atual,
                  )
                }
              />
            </div>

            <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-text-soft">
              Só isso — o resto o sistema gera depois
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="max-w-[220px]">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-soft">
                Código da peça
              </label>
              <input
                value={codigoPeca}
                onChange={(e) => setCodigoPeca(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 32,00"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
              />
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setPasso(1)}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream sm:w-auto"
              >
                ← Refazer fotos
              </button>
              <button
                onClick={handleContinuarRevisao}
                disabled={buscandoSemelhantes}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
              >
                {buscandoSemelhantes ? "Verificando…" : "Continuar →"}
              </button>
            </div>
          </div>
        )}

        {passo === 4 && (
          <div className="print:hidden">
            <h2 className="mb-1 text-lg font-semibold text-ink">
              {semelhantes.length > 0 ? "Encontramos um produto parecido" : "Nenhum produto parecido encontrado"}
            </h2>
            <p className="mb-4 text-sm text-text-soft">
              Comparação por categoria, material, cor e tags — não é comparação visual da foto.
            </p>

            {semelhantes.length > 0 && (
              <div className="flex flex-col gap-3">
                {semelhantes.slice(0, 1).map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-cream p-3">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-ink">{p.nome}</p>
                      <p className="text-xs text-text-soft">
                        {[p.categoria, p.subcategoria].filter(Boolean).join(" · ")}
                        {p.codigo_interno ? ` · #${p.codigo_interno}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-warn-bg px-2.5 py-1 text-xs font-bold text-warn">
                      {p.pontuacao}% parecido
                    </span>
                  </div>
                ))}

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    onClick={() => router.push(`/estoque?editar=${semelhantes[0].id}`)}
                    className="rounded-xl border-2 border-rose bg-rose-soft p-3 text-left"
                  >
                    <span className="block text-sm font-bold text-ink">Atualizar estoque</span>
                    <span className="text-xs text-rose-deep">Editar a quantidade do produto existente</span>
                  </button>
                  <button
                    onClick={handleConfirmarCadastro}
                    disabled={salvando}
                    className="rounded-xl border border-line p-3 text-left disabled:opacity-60"
                  >
                    <span className="block text-sm font-bold text-ink">Criar variação</span>
                    <span className="text-xs text-text-soft">Novo produto vinculado ao mesmo modelo</span>
                  </button>
                  <button
                    onClick={handleConfirmarCadastro}
                    disabled={salvando}
                    className="rounded-xl border border-line p-3 text-left disabled:opacity-60"
                  >
                    <span className="block text-sm font-bold text-ink">Novo cadastro</span>
                    <span className="text-xs text-text-soft">Seguir como peça totalmente nova</span>
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setPasso(3)}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream"
              >
                ← Voltar
              </button>
              {semelhantes.length === 0 && (
                <button
                  onClick={handleConfirmarCadastro}
                  disabled={salvando}
                  className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
                >
                  {salvando ? "Salvando…" : "Confirmar cadastro →"}
                </button>
              )}
            </div>
          </div>
        )}

        {passo === 5 && resultado && (
          <div>
            <div className="mb-4 flex items-center gap-3 print:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-bg text-lg font-black text-ok">
                ✓
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">Produto cadastrado com sucesso</h2>
                <p className="font-mono text-xs text-text-soft">#{resultado.codigoInterno}</p>
              </div>
            </div>

            {resultado.avisoFotos && (
              <p className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm font-medium text-warn print:hidden">
                {resultado.avisoFotos}
              </p>
            )}

            <div className="max-w-[260px] rounded-2xl border border-line bg-cream p-4">
              <p className="font-display text-base font-semibold text-ink">{resultado.nome}</p>
              <p className="mb-2 text-xs text-text-soft">#{resultado.codigoInterno}</p>
              <svg ref={barcodeRef} className="w-full" />
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row print:hidden">
              <button
                onClick={() => window.print()}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-5 py-2.5 text-sm font-semibold text-gold-ink"
              >
                Imprimir etiqueta
              </button>
              <button
                onClick={() => {
                  setPasso(1);
                  setFotos({ frente: null, verso: null, detalhe: null });
                  setAnaliseOriginal(null);
                  setAnaliseEditada(null);
                  setCodigoPeca("");
                  setSemelhantes([]);
                  setResultado(null);
                }}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream"
              >
                Cadastrar outra peça
              </button>
              <Link
                href="/estoque"
                className="rounded-full border border-line px-4 py-2.5 text-center text-sm font-semibold text-text hover:bg-cream"
              >
                Ver no Estoque
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
