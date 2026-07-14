import { AppShell } from "@/components/app-shell";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { podeEditarFinanceiro } from "@/lib/permissoes";
import { hojeIso, isoEmDias } from "@/lib/datas";
import { comoLista } from "@/lib/supabase-embed";
import type { ContaPagarVencendo, ParcelaVencendo } from "@/lib/types";

const PAPEL_LABEL: Record<string, string> = {
  admin: "Admin",
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await getPerfilAtual();
  const papelLabel = PAPEL_LABEL[perfil.papel] ?? "Sem papel";
  const inicial = perfil.nome.charAt(0).toUpperCase();

  const hoje = hojeIso();
  const limite = isoEmDias(2);
  const supabase = await createClient();

  // Alerta de vencimento respeita o mesmo limite de acesso do módulo
  // Financeiro: contas a receber pra admin/financeiro, contas a pagar só
  // pro admin (pedido explícito do usuário — financeiro não precisa ser
  // avisado de contas a pagar). As duas consultas rodam em paralelo, num
  // client só, em vez de sequenciais — isso corre em todo carregamento
  // do layout raiz, então serializar aqui custa caro em todas as páginas.
  const [receber, pagar] = await Promise.all([
    podeEditarFinanceiro(perfil.papel)
      ? supabase
          .from("contas_receber")
          .select("id, valor, vencimento, clientes(nome, telefone), pedidos(numero)")
          .neq("situacao", "pago")
          .gte("vencimento", hoje)
          .lte("vencimento", limite)
          .order("vencimento")
      : Promise.resolve({ data: null }),
    perfil.papel === "admin"
      ? supabase
          .from("contas_pagar")
          .select("id, valor, vencimento, descricao, fornecedores(nome)")
          .neq("situacao", "pago")
          .gte("vencimento", hoje)
          .lte("vencimento", limite)
          .order("vencimento")
      : Promise.resolve({ data: null }),
  ]);
  const parcelasVencendo = comoLista<ParcelaVencendo>(receber.data);
  const contasPagarVencendo = comoLista<ContaPagarVencendo>(pagar.data);

  return (
    <AppShell
      nome={perfil.nome}
      papelLabel={papelLabel}
      inicial={inicial}
      parcelasVencendo={parcelasVencendo}
      contasPagarVencendo={contasPagarVencendo}
    >
      {children}
    </AppShell>
  );
}
