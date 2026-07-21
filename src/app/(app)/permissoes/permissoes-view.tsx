"use client";

import { useMemo, useState, useTransition } from "react";
import { concederPermissao, revogarPermissao } from "@/lib/actions/permissoes";
import { criarFuncionario } from "@/lib/actions/funcionarios";
import { PERMISSAO_LABEL, PERMISSOES_ORDENADAS } from "@/lib/permissao-especial";
import { formatarDataHoraIso } from "@/lib/datas";
import type { PermissaoUsuario } from "@/lib/types";
import type { PerfilComPapel } from "./page";

const PAPEL_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

const PAPEIS_CADASTRAVEIS = ["vendedor", "financeiro", "estoque"] as const;

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
    <div className="flex flex-col gap-5">
      <CadastrarFuncionario />
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
    </div>
  );
}

function CadastrarFuncionario() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<(typeof PAPEIS_CADASTRAVEIS)[number]>("vendedor");
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null);

  function cadastrar() {
    if (!nome.trim() || !email.trim()) {
      setErro("Preencha nome e e-mail.");
      return;
    }
    setErro(null);
    setSenhaGerada(null);
    iniciar(async () => {
      const resultado = await criarFuncionario(nome, email, papel);
      if (resultado.erro) setErro(resultado.erro);
      if (resultado.senhaTemporaria) {
        setSenhaGerada(resultado.senhaTemporaria);
        setNome("");
        setEmail("");
        setPapel("vendedor");
      }
    });
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">Cadastrar funcionário</h2>

      {senhaGerada && (
        <div className="mb-3 flex flex-col gap-1 rounded-lg border-2 border-ok bg-ok-bg p-3 text-sm">
          <p className="font-semibold text-ok">Funcionário criado! Senha temporária (só aparece uma vez):</p>
          <code className="select-all rounded bg-surface px-2 py-1 font-mono text-sm text-ink">{senhaGerada}</code>
          <p className="text-xs text-text-soft">
            Repasse com segurança — a pessoa pode trocar em &quot;Minha conta&quot; depois de entrar.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome completo"
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="E-mail"
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
        />
        <select
          value={papel}
          onChange={(e) => setPapel(e.target.value as (typeof PAPEIS_CADASTRAVEIS)[number])}
          className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
        >
          {PAPEIS_CADASTRAVEIS.map((p) => (
            <option key={p} value={p}>
              {PAPEL_LABEL[p]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={cadastrar}
          className="rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Criando…" : "Cadastrar"}
        </button>
      </div>
      {erro && <p className="mt-2 text-sm font-medium text-crit">{erro}</p>}
      <p className="mt-2 text-xs text-text-soft">
        Pra criar outro administrador, use o Supabase Dashboard diretamente — por segurança, o cadastro pelo app só
        cria os papéis operacionais.
      </p>
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
