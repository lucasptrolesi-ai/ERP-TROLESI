"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { filtra } from "@/lib/filtra";
import { devolverProdutoEstoque } from "@/lib/actions/pdv-eventos";
import type { ProdutoEventoVinculado } from "@/lib/types";

export function DevolucaoModal({
  aberto,
  onFechar,
  produtosEventoVinculados,
}: {
  aberto: boolean;
  onFechar: () => void;
  produtosEventoVinculados: ProdutoEventoVinculado[];
}) {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<ProdutoEventoVinculado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [devolvendo, iniciarDevolucao] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const filtrados = useMemo(
    () => filtra(produtosEventoVinculados, busca, (p) => p.codigo_interno),
    [produtosEventoVinculados, busca],
  );

  function fecharTudo() {
    setBusca("");
    setSelecionado(null);
    setErro(null);
    setMensagemSucesso(null);
    onFechar();
  }

  function selecionar(produto: ProdutoEventoVinculado) {
    setSelecionado(produto);
    setErro(null);
    setMensagemSucesso(null);
  }

  function handleDevolver(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selecionado) return;
    const dados = new FormData(e.currentTarget);
    const quantidade = Math.max(1, Math.trunc(Number(dados.get("quantidade")) || 0));

    setErro(null);
    iniciarDevolucao(async () => {
      const resultado = await devolverProdutoEstoque(selecionado.id, quantidade);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setMensagemSucesso(`${quantidade}x "${selecionado.nome}" devolvido(s) pro estoque real.`);
      setSelecionado(null);
    });
  }

  return (
    <Modal aberto={aberto} onFechar={fecharTudo} titulo={selecionado ? "Devolução" : "Devolução do evento"}>
      {mensagemSucesso && !selecionado && (
        <p className="mb-3 rounded-lg bg-ok-bg px-3 py-2 text-sm font-medium text-ok">{mensagemSucesso}</p>
      )}

      {!selecionado && (
        <div className="flex flex-col gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código"
            autoFocus
            className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose"
          />
          <div className="flex max-h-[50vh] flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {filtrados.map((p) => (
              <button
                key={p.id}
                onClick={() => selecionar(p)}
                className="flex items-center gap-3 px-3 py-2.5 text-left hover:bg-cream"
              >
                {p.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto vem do Storage, sem otimização
                  <img src={p.foto_url} alt={p.nome} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[0.55rem] text-text-soft">
                    sem foto
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-ink">{p.nome}</span>
                  <span className="text-xs text-text-soft">#{p.codigo_interno}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-rose-deep">{p.quantidade_estoque} un. no evento</span>
              </button>
            ))}
            {filtrados.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-text-soft">
                {busca
                  ? "Nenhuma peça encontrada pra essa busca."
                  : "Nenhuma peça importada do evento com estoque disponível pra devolver."}
              </p>
            )}
          </div>
        </div>
      )}

      {selecionado && (
        <form ref={formRef} onSubmit={handleDevolver} className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-cream p-3">
            {selecionado.foto_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto vem do Storage, sem otimização
              <img src={selecionado.foto_url} alt={selecionado.nome} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[0.55rem] text-text-soft">
                sem foto
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-ink">{selecionado.nome}</span>
              <span className="text-xs text-text-soft">{selecionado.quantidade_estoque} un. ainda no evento</span>
            </span>
          </div>

          <FormField
            label="Quantidade a devolver"
            name="quantidade"
            type="number"
            step="1"
            min={1}
            max={selecionado.quantidade_estoque}
            defaultValue={selecionado.quantidade_estoque}
            required
          />

          {erro && <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">{erro}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setSelecionado(null)}
              className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-text hover:bg-cream"
            >
              ← Voltar
            </button>
            <button
              type="submit"
              disabled={devolvendo}
              className="flex-1 rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink transition disabled:opacity-60"
            >
              {devolvendo ? "Devolvendo…" : "Devolver pro estoque"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
