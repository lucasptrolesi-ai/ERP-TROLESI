"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { autorizarAcao } from "@/lib/actions/varejo";
import type { AcaoPrivilegiada, Supervisor } from "@/lib/varejo/tipos";

/**
 * PIN de supervisor: libera UMA ação específica, uma única vez, por 5 minutos (nunca a sessão
 * inteira) — mesmo comportamento em toda tela do varejo que precisa de autorização. Ao autorizar,
 * devolve o id da autorização pontual para `onAutorizado`; quem chama repassa esse id na mesma ação
 * (registrar_venda, cancelar_venda etc.), que consome a autorização no banco.
 */
export function PinSupervisorModal({
  aberto,
  onFechar,
  acao,
  alvoId,
  supervisores,
  onAutorizado,
}: {
  aberto: boolean;
  onFechar: () => void;
  acao: AcaoPrivilegiada;
  alvoId: string | null;
  supervisores: Supervisor[];
  onAutorizado: (autorizacaoId: string) => void;
}) {
  const [supervisorId, setSupervisorId] = useState(supervisores[0]?.profile_id ?? "");
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const MENSAGENS: Record<string, string> = {
    pin_invalido: "PIN incorreto.",
    supervisor_invalido: "Selecione um supervisor válido.",
    bloqueado: "Esse supervisor está bloqueado temporariamente após muitas tentativas erradas.",
    auto_autorizacao: "Um supervisor não pode autorizar a própria ação.",
    erro: "Não foi possível autorizar. Tente novamente.",
  };

  function confirmar() {
    if (!supervisorId) {
      setErro("Selecione um supervisor.");
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setErro("Digite o PIN (4 a 8 dígitos).");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await autorizarAcao(supervisorId, pin, acao, alvoId);
      if (!resultado.ok || !resultado.autorizacaoId) {
        setErro(MENSAGENS[resultado.motivo ?? "erro"] ?? MENSAGENS.erro);
        setPin("");
        return;
      }
      setPin("");
      onAutorizado(resultado.autorizacaoId);
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Autorização do supervisor">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-soft">
          Esta ação exige o PIN de um supervisor. A autorização vale só para esta ação, uma única vez.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Supervisor
          <select
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className="rounded-lg border border-line bg-surface px-3 py-2"
          >
            {supervisores.length === 0 && <option value="">Nenhum supervisor cadastrado</option>}
            {supervisores.map((s) => (
              <option key={s.profile_id} value={s.profile_id}>
                {s.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && confirmar()}
            className="rounded-lg border border-line bg-surface px-3 py-2 tracking-[0.3em]"
            autoFocus
          />
        </label>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
        <button
          type="button"
          onClick={confirmar}
          disabled={pendente}
          className="rounded-lg bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Autorizando…" : "Autorizar"}
        </button>
      </div>
    </Modal>
  );
}
