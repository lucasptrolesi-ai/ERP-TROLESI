import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarFinanceiro } from "@/lib/permissoes";
import { comoLista } from "@/lib/supabase-embed";
import { FinanceiroView } from "./financeiro-view";
import type { ContaPagar, ContaReceberFinanceiro } from "@/lib/types";

export default async function FinanceiroPage() {
  const perfil = await getPerfilAtual();

  // RLS libera contas_receber/contas_pagar só pra admin/financeiro — sem
  // essa checagem explícita, quem não tem acesso veria a tela inteira
  // "zerada" (sem erro nenhum), parecendo que não há nada a receber/pagar
  // em vez de "você não tem permissão pra ver isso".
  if (!podeEditarFinanceiro(perfil.papel)) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar o Financeiro. Fale com um admin se precisar de acesso.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: contasReceber }, { data: contasPagar }, { data: fornecedores }] = await Promise.all([
    supabase
      .from("contas_receber")
      .select(
        "id, cliente_id, valor, vencimento, situacao, pago_em, forma_pagamento, valor_pago, forma_pagamento_baixa, observacao_baixa, numero_parcela, total_parcelas, clientes(nome), pedidos(numero)",
      )
      .order("vencimento"),
    supabase
      .from("contas_pagar")
      .select(
        "id, fornecedor_id, descricao, valor, vencimento, situacao, pago_em, valor_pago, forma_pagamento_baixa, observacao_baixa, fornecedores(nome)",
      )
      .order("vencimento"),
    supabase.from("fornecedores").select("*").eq("ativo", true).order("nome"),
  ]);

  return (
    <FinanceiroView
      contasReceber={comoLista<ContaReceberFinanceiro>(contasReceber)}
      contasPagar={comoLista<ContaPagar>(contasPagar)}
      fornecedores={fornecedores ?? []}
    />
  );
}
