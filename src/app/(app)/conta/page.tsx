"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormField } from "@/components/form-field";

export default function ContaPage() {
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) {
      setErro("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmarSenha) {
      setErro("As senhas não coincidem.");
      return;
    }
    setErro(null);
    setSucesso(false);
    setSalvando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      setErro("Não foi possível trocar a senha. Tente novamente.");
      return;
    }
    setSenha("");
    setConfirmarSenha("");
    setSucesso(true);
  }

  return (
    <div className="mx-auto max-w-sm rounded-[14px] border border-line bg-surface p-6 shadow-sm">
      <h1 className="mb-4 font-display text-lg font-semibold text-ink">Trocar minha senha</h1>
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <FormField
          label="Nova senha"
          name="senha"
          type="password"
          required
          autoComplete="new-password"
          onChange={(e) => setSenha(e.target.value)}
        />
        <FormField
          label="Confirmar nova senha"
          name="confirmar_senha"
          type="password"
          required
          autoComplete="new-password"
          onChange={(e) => setConfirmarSenha(e.target.value)}
        />

        {erro && <p className="text-sm font-medium text-crit">{erro}</p>}
        {sucesso && <p className="text-sm font-medium text-ok">Senha alterada com sucesso.</p>}

        <button
          type="submit"
          disabled={salvando}
          className="mt-1 rounded-full bg-gradient-to-br from-rose to-rose-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {salvando ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </div>
  );
}
