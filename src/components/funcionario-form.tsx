"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { createClient } from "@/lib/supabase/client";
import { criarFuncionario, atualizarFuncionario, resetarSenhaFuncionario } from "@/lib/actions/funcionarios";
import type { Funcionario } from "@/lib/types";

const PAPEIS_CRIACAO = ["vendedor", "financeiro", "estoque"] as const;
const PAPEIS_EDICAO = ["admin", "vendedor", "financeiro", "estoque"] as const;

const PAPEL_LABEL: Record<string, string> = {
  admin: "Admin",
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

export function FuncionarioForm({
  aberto,
  onFechar,
  funcionario,
  meuId,
}: {
  aberto: boolean;
  onFechar: () => void;
  funcionario: Funcionario | null;
  meuId: string;
}) {
  const router = useRouter();
  const ehEdicao = funcionario !== null;
  const ehVoceMesmo = funcionario?.id === meuId;
  const [nome, setNome] = useState(funcionario?.nome ?? "");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<string>(funcionario?.papel ?? "vendedor");
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [senhaDefinida, setSenhaDefinida] = useState(false);

  function salvar() {
    if (!nome.trim() || (!ehEdicao && !email.trim())) {
      setErro("Preencha os campos obrigatórios.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = ehEdicao
        ? await atualizarFuncionario(funcionario.id, nome, papel as (typeof PAPEIS_EDICAO)[number])
        : await criarFuncionario(nome, email, papel as (typeof PAPEIS_CRIACAO)[number]);
      if (resultado.erro) setErro(resultado.erro);
      if ("senhaTemporaria" in resultado && resultado.senhaTemporaria) {
        setSenhaGerada(resultado.senhaTemporaria);
      } else if (!resultado.erro) {
        onFechar();
      }
    });
  }

  function resetarSenha() {
    if (!funcionario) return;
    // Gerar senha aleatória só faz sentido pra resetar a senha de outra
    // pessoa — resetando a própria conta, uma senha que você mesmo não
    // escolheu e não vai ver (a sessão morre antes de mostrar) te deixaria
    // travado fora sem saber qual é.
    if (ehVoceMesmo && !novaSenha.trim()) {
      setErro("Digite a nova senha — pra sua própria conta, não dá pra gerar uma aleatória (você seria desconectado sem vê-la).");
      return;
    }
    if (novaSenha && novaSenha.length < 8) {
      setErro("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (ehVoceMesmo && !confirm("Isso vai desconectar sua sessão atual — você precisará entrar de novo com a nova senha. Continuar?")) {
      return;
    }
    setErro(null);
    setSenhaDefinida(false);
    iniciar(async () => {
      const resultado = await resetarSenhaFuncionario(funcionario.id, novaSenha || undefined);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      // Trocar a própria senha por aqui (API administrativa) invalida a
      // sessão atual — diferente de "Minha conta", que atualiza a sessão no
      // mesmo lugar. Desloga explicitamente em vez de deixar a pessoa
      // navegando com uma sessão já morta até um clique qualquer falhar sem
      // explicação (foi exatamente isso que aconteceu antes dessa correção).
      if (ehVoceMesmo) {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push("/login");
        return;
      }
      if (resultado.senhaTemporaria) {
        setSenhaGerada(resultado.senhaTemporaria);
      } else {
        setSenhaDefinida(true);
      }
      setNovaSenha("");
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={ehEdicao ? "Editar funcionário" : "Novo funcionário"}>
      <div className="flex flex-col gap-4">
        {senhaGerada && (
          <div className="flex flex-col gap-1 rounded-lg border-2 border-ok bg-ok-bg p-3 text-sm">
            <p className="font-semibold text-ok">Senha temporária (só aparece uma vez):</p>
            <code className="select-all rounded bg-surface px-2 py-1 font-mono text-sm text-ink">{senhaGerada}</code>
            <p className="text-xs text-text-soft">
              Repasse com segurança — a pessoa pode trocar em &quot;Minha conta&quot; depois de entrar.
            </p>
          </div>
        )}

        <FormField label="Nome completo" name="nome" defaultValue={nome} onChange={(e) => setNome(e.target.value)} />

        {ehEdicao ? (
          <p className="text-xs text-text-soft">E-mail: {funcionario.email ?? "—"}</p>
        ) : (
          <FormField
            label="E-mail"
            name="email"
            type="email"
            defaultValue={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Papel</label>
          <select
            value={papel}
            onChange={(e) => setPapel(e.target.value)}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink"
          >
            {(ehEdicao ? PAPEIS_EDICAO : PAPEIS_CRIACAO).map((p) => (
              <option key={p} value={p}>
                {PAPEL_LABEL[p]}
              </option>
            ))}
          </select>
          {!ehEdicao && (
            <p className="text-xs text-text-soft">
              Pra criar outro administrador, use o Supabase Dashboard diretamente.
            </p>
          )}
        </div>

        {ehEdicao && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">Trocar senha</label>
            {ehVoceMesmo && (
              <p className="rounded-lg bg-warn-bg px-2 py-1.5 text-xs font-medium text-warn">
                Essa é a sua própria conta — trocar por aqui vai desconectar sua sessão atual (você entra de novo com
                a senha nova). Pra trocar sem sair, use &quot;Minha conta&quot; no menu lateral.
              </p>
            )}
            <input
              type="text"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder={
                ehVoceMesmo ? "Digite a nova senha" : "Digite a nova senha (deixe em branco pra gerar uma aleatória)"
              }
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
            {senhaDefinida && <p className="text-xs font-medium text-ok">Senha alterada com sucesso.</p>}
            <button
              type="button"
              disabled={pending}
              onClick={resetarSenha}
              className="w-fit rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {novaSenha ? "Definir esta senha" : "Gerar senha aleatória"}
            </button>
          </div>
        )}

        {erro && <p className="text-sm font-medium text-crit">{erro}</p>}

        <button
          type="button"
          disabled={pending}
          onClick={salvar}
          className="w-fit rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Salvando…" : ehEdicao ? "Salvar" : "Cadastrar"}
        </button>
      </div>
    </Modal>
  );
}
