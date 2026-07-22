"use client";

import { useMemo, useState, useTransition } from "react";
import { ClienteForm } from "@/components/cliente-form";
import { FornecedorForm } from "@/components/fornecedor-form";
import { FuncionarioForm } from "@/components/funcionario-form";
import { alternarAtivoCliente } from "@/lib/actions/clientes";
import { alternarAtivoFornecedor } from "@/lib/actions/fornecedores";
import { alternarAtivoFuncionario, excluirFuncionario } from "@/lib/actions/funcionarios";
import { filtra } from "@/lib/filtra";
import * as permissoes from "@/lib/permissoes";
import type { Cliente, Fornecedor, Funcionario } from "@/lib/types";

const PAPEL_LABEL: Record<string, string> = {
  admin: "Admin",
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

type Aba = "clientes" | "fornecedores" | "funcionarios";

const ABAS: readonly [Aba, string][] = [
  ["clientes", "Clientes"],
  ["fornecedores", "Fornecedores"],
  ["funcionarios", "Funcionários"],
];

export function CadastrosView({
  papelAtual,
  meuId,
  clientes,
  fornecedores,
  funcionarios,
}: {
  papelAtual: string;
  meuId: string;
  clientes: Cliente[];
  fornecedores: Fornecedor[];
  funcionarios: Funcionario[];
}) {
  const [aba, setAba] = useState<Aba>("clientes");
  const [busca, setBusca] = useState("");
  const [clienteEditando, setClienteEditando] = useState<Cliente | null | undefined>(undefined);
  const [fornecedorEditando, setFornecedorEditando] = useState<Fornecedor | null | undefined>(undefined);
  const [funcionarioEditando, setFuncionarioEditando] = useState<Funcionario | null | undefined>(undefined);

  const podeEditarClientes = permissoes.podeEditarClientes(papelAtual);
  const podeEditarFornecedores = permissoes.podeEditarFornecedores(papelAtual);

  const clientesFiltrados = useMemo(
    () => filtra(clientes, busca, (c) => `${c.telefone ?? ""} ${c.cidade ?? ""} ${c.cpf_cnpj ?? ""}`),
    [clientes, busca],
  );
  const fornecedoresFiltrados = useMemo(
    () => filtra(fornecedores, busca, (f) => `${f.telefone ?? ""} ${f.cidade ?? ""} ${f.cnpj ?? ""}`),
    [fornecedores, busca],
  );
  const funcionariosFiltrados = useMemo(
    () => filtra(funcionarios, busca),
    [funcionarios, busca],
  );

  return (
    <div className="rounded-[14px] border border-line bg-surface shadow-sm">
      <div className="flex gap-4 overflow-x-auto border-b border-line px-4 sm:gap-6 sm:px-5">
        {ABAS
          // RLS só libera o próprio perfil pra quem não é admin — mostrar
          // essa aba pra outros papéis só exibiria uma lista de 1 pessoa
          // sem explicação, então nem aparece.
          .filter(([valor]) => valor !== "funcionarios" || papelAtual === "admin")
          .map(([valor, rotulo]) => (
          <button
            key={valor}
            onClick={() => setAba(valor)}
            className={`shrink-0 border-b-2 py-3 text-sm font-semibold ${
              aba === valor ? "border-rose text-rose-deep" : "border-transparent text-text-soft"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, cidade, telefone ou documento"
          className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink outline-none focus:border-rose sm:max-w-xs"
        />
        {aba === "clientes" && podeEditarClientes && (
          <button
            onClick={() => setClienteEditando(null)}
            className="shrink-0 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2 text-sm font-semibold text-white"
          >
            + Novo cliente
          </button>
        )}
        {aba === "fornecedores" && podeEditarFornecedores && (
          <button
            onClick={() => setFornecedorEditando(null)}
            className="shrink-0 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2 text-sm font-semibold text-white"
          >
            + Novo fornecedor
          </button>
        )}
        {aba === "funcionarios" && papelAtual === "admin" && (
          <button
            onClick={() => setFuncionarioEditando(null)}
            className="shrink-0 rounded-full bg-gradient-to-br from-rose to-rose-deep px-4 py-2 text-sm font-semibold text-white"
          >
            + Novo funcionário
          </button>
        )}
      </div>

      {aba === "clientes" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Nome</th>
                <th className="px-5 py-2">CPF/CNPJ</th>
                <th className="px-5 py-2">Telefone</th>
                <th className="px-5 py-2">Cidade/UF</th>
                <th className="px-5 py-2">Status</th>
                {podeEditarClientes && <th className="px-5 py-2" />}
              </tr>
            </thead>
            <tbody>
              {clientesFiltrados.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-5 py-2.5">{c.nome}</td>
                  <td className="px-5 py-2.5">{c.cpf_cnpj ?? "—"}</td>
                  <td className="px-5 py-2.5">{c.telefone ?? "—"}</td>
                  <td className="px-5 py-2.5">{[c.cidade, c.uf].filter(Boolean).join("/") || "—"}</td>
                  <td className="px-5 py-2.5">
                    <StatusPill ativo={c.ativo} />
                  </td>
                  {podeEditarClientes && (
                    <td className="px-5 py-2.5 text-right">
                      <AcoesLinha
                        onEditar={() => setClienteEditando(c)}
                        ativo={c.ativo}
                        onAlternarAtivo={() => alternarAtivoCliente(c.id, !c.ativo)}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {clientesFiltrados.length === 0 && <LinhaVazia colSpan={6} texto="Nenhum cliente encontrado." />}
            </tbody>
          </table>
        </div>
      )}

      {aba === "fornecedores" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Nome</th>
                <th className="px-5 py-2">CNPJ</th>
                <th className="px-5 py-2">Telefone</th>
                <th className="px-5 py-2">Cidade/UF</th>
                <th className="px-5 py-2">Status</th>
                {podeEditarFornecedores && <th className="px-5 py-2" />}
              </tr>
            </thead>
            <tbody>
              {fornecedoresFiltrados.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-5 py-2.5">{f.nome}</td>
                  <td className="px-5 py-2.5">{f.cnpj ?? "—"}</td>
                  <td className="px-5 py-2.5">{f.telefone ?? "—"}</td>
                  <td className="px-5 py-2.5">{[f.cidade, f.uf].filter(Boolean).join("/") || "—"}</td>
                  <td className="px-5 py-2.5">
                    <StatusPill ativo={f.ativo} />
                  </td>
                  {podeEditarFornecedores && (
                    <td className="px-5 py-2.5 text-right">
                      <AcoesLinha
                        onEditar={() => setFornecedorEditando(f)}
                        ativo={f.ativo}
                        onAlternarAtivo={() => alternarAtivoFornecedor(f.id, !f.ativo)}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {fornecedoresFiltrados.length === 0 && (
                <LinhaVazia colSpan={6} texto="Nenhum fornecedor encontrado." />
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === "funcionarios" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-text-soft">
                <th className="px-5 py-2">Nome</th>
                <th className="px-5 py-2">E-mail</th>
                <th className="px-5 py-2">Papel</th>
                <th className="px-5 py-2">Status</th>
                {papelAtual === "admin" && <th className="px-5 py-2" />}
              </tr>
            </thead>
            <tbody>
              {funcionariosFiltrados.map((f) => (
                <LinhaFuncionario
                  key={f.id}
                  funcionario={f}
                  podeGerenciar={papelAtual === "admin"}
                  ehVoceMesmo={f.id === meuId}
                  onEditar={() => setFuncionarioEditando(f)}
                />
              ))}
              {funcionariosFiltrados.length === 0 && <LinhaVazia colSpan={5} texto="Nenhum funcionário." />}
            </tbody>
          </table>
          <p className="px-5 py-3 text-xs text-text-soft">
            Criar outro administrador ainda exige o Supabase Dashboard, por segurança.
          </p>
        </div>
      )}

      {clienteEditando !== undefined && (
        <ClienteForm
          key={clienteEditando?.id ?? "novo-cliente"}
          aberto
          onFechar={() => setClienteEditando(undefined)}
          cliente={clienteEditando}
        />
      )}
      {fornecedorEditando !== undefined && (
        <FornecedorForm
          key={fornecedorEditando?.id ?? "novo-fornecedor"}
          aberto
          onFechar={() => setFornecedorEditando(undefined)}
          fornecedor={fornecedorEditando}
        />
      )}
      {funcionarioEditando !== undefined && (
        <FuncionarioForm
          key={funcionarioEditando?.id ?? "novo-funcionario"}
          aberto
          onFechar={() => setFuncionarioEditando(undefined)}
          funcionario={funcionarioEditando}
        />
      )}
    </div>
  );
}

function LinhaFuncionario({
  funcionario: f,
  podeGerenciar,
  ehVoceMesmo,
  onEditar,
}: {
  funcionario: Funcionario;
  podeGerenciar: boolean;
  ehVoceMesmo: boolean;
  onEditar: () => void;
}) {
  const [pending, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function alternarAtivo() {
    setErro(null);
    iniciar(async () => {
      const resultado = await alternarAtivoFuncionario(f.id, !f.ativo);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  function excluir() {
    if (!confirm(`Excluir ${f.nome}? Essa ação não pode ser desfeita.`)) return;
    setErro(null);
    iniciar(async () => {
      const resultado = await excluirFuncionario(f.id);
      if (resultado.erro) setErro(resultado.erro);
    });
  }

  return (
    <tr className="border-t border-line">
      <td className="px-5 py-2.5">{f.nome}</td>
      <td className="px-5 py-2.5">{f.email ?? "—"}</td>
      <td className="px-5 py-2.5">{PAPEL_LABEL[f.papel] ?? f.papel}</td>
      <td className="px-5 py-2.5">
        <StatusPill ativo={f.ativo} />
        {erro && <p className="mt-1 text-xs font-medium text-crit">{erro}</p>}
      </td>
      {podeGerenciar && (
        <td className="px-5 py-2.5 text-right">
          <div className="flex justify-end gap-3 text-xs font-semibold">
            <button onClick={onEditar} className="text-rose-deep hover:underline">
              Editar
            </button>
            {!ehVoceMesmo && (
              <>
                <button disabled={pending} onClick={alternarAtivo} className="text-text-soft hover:underline disabled:opacity-60">
                  {f.ativo ? "Desativar" : "Ativar"}
                </button>
                <button disabled={pending} onClick={excluir} className="text-crit hover:underline disabled:opacity-60">
                  Excluir
                </button>
              </>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function StatusPill({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold before:h-1.5 before:w-1.5 before:rounded-full before:bg-current ${
        ativo ? "bg-ok-bg text-ok" : "bg-line text-text-soft"
      }`}
    >
      {ativo ? "Ativo" : "Inativo"}
    </span>
  );
}

function AcoesLinha({
  onEditar,
  ativo,
  onAlternarAtivo,
}: {
  onEditar: () => void;
  ativo: boolean;
  onAlternarAtivo: () => void;
}) {
  return (
    <div className="flex justify-end gap-3 text-xs font-semibold">
      <button onClick={onEditar} className="text-rose-deep hover:underline">
        Editar
      </button>
      <button onClick={onAlternarAtivo} className="text-text-soft hover:underline">
        {ativo ? "Desativar" : "Ativar"}
      </button>
    </div>
  );
}

function LinhaVazia({ colSpan, texto }: { colSpan: number; texto: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-text-soft">
        {texto}
      </td>
    </tr>
  );
}
