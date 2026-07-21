"use client";

import { useMemo, useState, useTransition } from "react";
import { concederPermissao, revogarPermissao } from "@/lib/actions/permissoes";
import { PERMISSAO_LABEL, PERMISSOES_ORDENADAS } from "@/lib/permissao-especial";
import { formatarDataHoraIso } from "@/lib/datas";
import type { PermissaoUsuario } from "@/lib/types";
import type { PerfilComPapel } from "./page";

const PAPEL_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

export function PermissoesView({ perfis, permissoes }: { perfis: PerfilComPapel[]; permissoes: PermissaoUsuario[] }) {
  const [selecionadoId, setSelecionadoId] = useState<string | null>(perfis[0]?.id ?? null);

  const permissoesPorPerfil = useMemo(() => {
    const mapa = new Map<string, Map<string, PermissaoUsuario>>();
    for (const p of permissoes) {
      if (!mapa.has(p.profile_id)) mapa.set(p.profile_id, new Map());
      mapa.get(p.profile_id)!.set(p.permissao, p);
    }
    return mapa;
  }, [permissoes]);

  const selecionado = perfis.find((p) => p.id === selecionadoId) ?? null;
  const permissoesDoSelecionado = selecionado ? (permissoesPorPerfil.get(selecionado.id) ?? new Map()) : new Map();

  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      <div className="w-full shrink-0 rounded-[14px] border border-line bg-surface shadow-sm sm:w-72">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-base font-semibold text-ink">Usuários</h2>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {perfis.map((p) => {
            const qtd = permissoesPorPerfil.get(p.id)?.size ?? 0;
            const ativo = p.id === selecionadoId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelecionadoId(p.id)}
                className={`flex items-center justify-between px-4 py-3 text-left text-sm ${
                  ativo ? "bg-rose-soft/40 font-semibold text-rose-deep" : "text-ink hover:bg-cream"
                }`}
              >
                <span className="flex flex-col">
                  {p.nome}
                  <span className="text-xs font-normal text-text-soft">{PAPEL_LABEL[p.papel] ?? p.papel}</span>
                </span>
                <span className="rounded-full bg-line px-2 py-0.5 text-xs text-text-soft">{qtd}</span>
              </button>
            );
          })}
          {perfis.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-soft">Nenhum usuário não-admin ativo cadastrado.</p>
          )}
        </div>
      </div>

      <div className="flex-1 rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-base font-semibold text-ink">
            {selecionado ? `Permissões de ${selecionado.nome}` : "Selecione um usuário"}
          </h2>
        </div>
        {selecionado && (
          <div className="flex flex-col divide-y divide-line">
            {PERMISSOES_ORDENADAS.map((permissao) => (
              <LinhaPermissao
                key={permissao}
                profileId={selecionado.id}
                permissao={permissao}
                concedida={permissoesDoSelecionado.get(permissao) ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinhaPermissao({
  profileId,
  permissao,
  concedida,
}: {
  profileId: string;
  permissao: string;
  concedida: PermissaoUsuario | null;
}) {
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const concedidaTipada = permissao as PermissaoUsuario["permissao"];

  function alternar() {
    setErro(null);
    iniciar(async () => {
      const resultado = concedida
        ? await revogarPermissao(profileId, concedidaTipada)
        : await concederPermissao(profileId, concedidaTipada);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-ink">{PERMISSAO_LABEL[concedidaTipada]}</span>
          {concedida && (
            <span className="text-xs text-text-soft">Concedida em {formatarDataHoraIso(concedida.concedida_em)}</span>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!concedida}
          disabled={pending}
          onClick={alternar}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            concedida ? "bg-rose-deep" : "bg-line"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              concedida ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {erro && <p className="text-xs font-medium text-crit">{erro}</p>}
    </div>
  );
}
