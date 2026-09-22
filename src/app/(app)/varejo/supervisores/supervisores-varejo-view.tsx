"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { definirPinSupervisor } from "@/lib/actions/varejo";

type UsuarioDaOperacao = { profile_id: string; nome: string; ehSupervisor: boolean; ativo: boolean };

export function SupervisoresVarejoView({ usuarios }: { usuarios: UsuarioDaOperacao[] }) {
  const [alvo, setAlvo] = useState<UsuarioDaOperacao | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Supervisores do varejo</h1>
        <p className="text-sm text-text-soft">
          Quem tem PIN pode autorizar desconto abaixo do mínimo, cancelamento de venda e estorno — uma ação por vez, nunca
          a própria sessão.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-text-soft">
              <th className="px-4 py-2.5">Usuário</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.profile_id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{u.nome}</td>
                <td className="px-4 py-2.5">
                  {u.ehSupervisor ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Supervisor</span>
                  ) : (
                    <span className="text-text-soft">Sem PIN</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" onClick={() => setAlvo(u)} className="text-xs font-semibold text-rose-deep underline decoration-dotted">
                    {u.ehSupervisor ? "Redefinir PIN" : "Definir PIN"}
                  </button>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-text-soft">
                  Nenhum usuário vinculado a esta operação ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {alvo && <DefinirPinModal usuario={alvo} onFechar={() => setAlvo(null)} />}
    </div>
  );
}

function DefinirPinModal({ usuario, onFechar }: { usuario: UsuarioDaOperacao; onFechar: () => void }) {
  const [pin, setPin] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar() {
    if (!/^\d{4,8}$/.test(pin)) {
      setErro("O PIN deve ter de 4 a 8 dígitos.");
      return;
    }
    if (pin !== confirmacao) {
      setErro("Os PINs não coincidem.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resposta = await definirPinSupervisor(usuario.profile_id, pin);
      if (resposta.erro) {
        setErro(resposta.erro);
        return;
      }
      onFechar();
    });
  }

  return (
    <Modal aberto onFechar={onFechar} titulo={`PIN de ${usuario.nome}`}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Novo PIN (4 a 8 dígitos)
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="rounded-lg border border-line bg-surface px-3 py-2 tracking-[0.3em]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Confirme o PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value.replace(/\D/g, ""))}
            className="rounded-lg border border-line bg-surface px-3 py-2 tracking-[0.3em]"
          />
        </label>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
        <button
          type="button"
          onClick={salvar}
          disabled={pendente}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Salvando…" : "Salvar PIN"}
        </button>
      </div>
    </Modal>
  );
}
