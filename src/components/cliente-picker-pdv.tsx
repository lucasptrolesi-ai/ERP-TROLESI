"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { buscarClientesVarejo, criarClienteRapidoVarejo, type ClienteResumoVarejo } from "@/lib/actions/clientes-varejo";

/**
 * Cliente de verdade no PDV Varejo (2026-10-19): busca por nome/telefone/CPF-CNPJ com um "+ Novo
 * cliente" pra cadastro rápido sem sair do balcão. Também aceita venda sem cliente vinculado (nome
 * solto, como sempre funcionou) — a venda só entra no cashback/histórico de cliente quando um
 * cadastro de verdade é selecionado.
 */
export function ClientePickerPdv({
  clienteSelecionado,
  onSelecionar,
  nomeLivre,
  onMudarNomeLivre,
}: {
  clienteSelecionado: ClienteResumoVarejo | null;
  onSelecionar: (cliente: ClienteResumoVarejo | null) => void;
  nomeLivre: string;
  onMudarNomeLivre: (nome: string) => void;
}) {
  const [resultados, setResultados] = useState<ClienteResumoVarejo[]>([]);
  const [novoAberto, setNovoAberto] = useState(false);
  const [, iniciarBusca] = useTransition();

  // `cancelada` evita que uma busca mais lenta de um termo ANTERIOR sobrescreva, depois de resolvida
  // fora de ordem, os resultados do termo digitado por último (mesmo achado de code review que gerou
  // a guarda equivalente no efeito de cashback do PDV).
  useEffect(() => {
    let cancelada = false;
    const id = setTimeout(() => {
      if (nomeLivre.trim().length < 2) {
        setResultados([]);
        return;
      }
      iniciarBusca(async () => {
        const lista = await buscarClientesVarejo(nomeLivre);
        if (!cancelada) setResultados(lista);
      });
    }, 250);
    return () => {
      cancelada = true;
      clearTimeout(id);
    };
  }, [nomeLivre]);

  if (clienteSelecionado) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-cream px-3 py-2 text-sm">
        <span>
          <span className="font-semibold">{clienteSelecionado.nome}</span>
          {clienteSelecionado.telefone && <span className="text-text-soft"> · {clienteSelecionado.telefone}</span>}
        </span>
        <button type="button" onClick={() => onSelecionar(null)} className="text-xs font-semibold text-rose-deep underline decoration-dotted">
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input
          type="text"
          value={nomeLivre}
          onChange={(e) => onMudarNomeLivre(e.target.value)}
          placeholder="Nome do cliente (opcional) — buscar cadastro ou digitar"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        {resultados.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-md">
            {resultados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelecionar(c);
                  setResultados([]);
                }}
                className="block w-full border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-cream"
              >
                <span className="font-medium">{c.nome}</span>
                {c.telefone && <span className="text-text-soft"> · {c.telefone}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => setNovoAberto(true)} className="self-start text-xs font-semibold text-rose-deep underline decoration-dotted">
        + Novo cliente
      </button>

      <Modal aberto={novoAberto} onFechar={() => setNovoAberto(false)} titulo="Novo cliente">
        <FormNovoCliente
          // `key` força remontar o form a cada abertura com o texto atual do campo de busca --
          // `defaultValue` só vale na montagem, e o form nunca desmonta de verdade (o <Modal> só
          // abre/fecha o <dialog>, os filhos continuam no DOM), então sem isso o campo "Nome" ficava
          // preso no texto de busca de quando o picker foi montado, ignorando edições depois disso.
          key={nomeLivre}
          nomeInicial={nomeLivre}
          onCriado={(cliente) => {
            onSelecionar(cliente);
            setNovoAberto(false);
          }}
          onCancelar={() => setNovoAberto(false)}
        />
      </Modal>
    </div>
  );
}

function FormNovoCliente({
  nomeInicial,
  onCriado,
  onCancelar,
}: {
  nomeInicial: string;
  onCriado: (cliente: ClienteResumoVarejo) => void;
  onCancelar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const resultado = await criarClienteRapidoVarejo(formData);
      if (resultado.erro || !resultado.cliente) {
        setErro(resultado.erro ?? "Não foi possível salvar.");
        return;
      }
      onCriado(resultado.cliente);
    });
  }

  return (
    <form action={salvar} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Nome
        <input name="nome" type="text" defaultValue={nomeInicial} required autoFocus className="rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Telefone
        <input name="telefone" type="text" className="rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        CPF/CNPJ
        <input name="cpf_cnpj" type="text" className="rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pendente}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Salvando…" : "Salvar e selecionar"}
        </button>
        <button type="button" onClick={onCancelar} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-text-soft">
          Cancelar
        </button>
      </div>
    </form>
  );
}
