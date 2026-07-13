"use client";

import { useMemo, useState } from "react";
import { ClienteForm } from "@/components/cliente-form";
import { filtra } from "@/lib/filtra";
import type { Cliente } from "@/lib/types";

export function PedidosView({ clientes }: { clientes: Cliente[] }) {
  const [busca, setBusca] = useState("");
  const [clienteEditando, setClienteEditando] = useState<Cliente | null | undefined>(undefined);

  const filtrados = useMemo(
    () => filtra(clientes, busca, (c) => `${c.telefone ?? ""} ${c.cpf_cnpj ?? ""}`),
    [clientes, busca],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-surface p-5 shadow-sm">
        <h1 className="font-display text-xl font-semibold text-ink">Novo pedido</h1>
        <p className="mt-1 text-sm text-text-soft">
          A tela completa de venda (produtos, carrinho, pagamento) chega junto com o módulo de
          Estoque. Por enquanto, dá pra buscar ou cadastrar rapidamente um cliente antes disso.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente por nome, telefone ou documento"
            className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-sm"
          />
          <button
            onClick={() => setClienteEditando(null)}
            className="shrink-0 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2 text-sm font-semibold text-white"
          >
            + Cadastro rápido de cliente
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
              <th className="px-5 py-2">Nome</th>
              <th className="px-5 py-2">CPF/CNPJ</th>
              <th className="px-5 py-2">Telefone</th>
              <th className="px-5 py-2">Cidade/UF</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((c) => (
              <tr
                key={c.id}
                onClick={() => setClienteEditando(c)}
                className="cursor-pointer border-t border-line hover:bg-cream"
              >
                <td className="px-5 py-2.5">{c.nome}</td>
                <td className="px-5 py-2.5">{c.cpf_cnpj ?? "—"}</td>
                <td className="px-5 py-2.5">{c.telefone ?? "—"}</td>
                <td className="px-5 py-2.5">{[c.cidade, c.uf].filter(Boolean).join("/") || "—"}</td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-text-soft">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {clienteEditando !== undefined && (
        <ClienteForm
          key={clienteEditando?.id ?? "novo-cliente"}
          aberto
          onFechar={() => setClienteEditando(undefined)}
          cliente={clienteEditando}
        />
      )}
    </div>
  );
}
