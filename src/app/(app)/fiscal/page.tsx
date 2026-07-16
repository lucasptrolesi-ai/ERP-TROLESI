import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarFinanceiro } from "@/lib/permissoes";
import { comoLista } from "@/lib/supabase-embed";
import { FiscalView } from "./fiscal-view";
import type { NotaFiscal, PedidoPendenteFiscal } from "@/lib/types";

export default async function FiscalPage() {
  const perfil = await getPerfilAtual();

  // Checagem em nível de app, não só RLS: a lista de "pendentes" vem da
  // tabela pedidos (sem RLS restrita por vendedor), então sem esse bloqueio
  // um vendedor veria os pedidos pendentes de nota de todo mundo, não só os
  // dele — não existe ainda uma tela "minhas vendas" pra vendedor aqui, então
  // por ora o acesso ao Fiscal fica só com admin/financeiro.
  if (!podeEditarFinanceiro(perfil.papel)) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar o Fiscal. Fale com um admin se precisar de acesso.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: notas }, { data: pedidosFaturados }] = await Promise.all([
    supabase
      .from("notas_fiscais")
      .select(
        "id, pedido_id, cliente_id, status, xml, chave_acesso, protocolo, valor_total, cfop, natureza_operacao, serie, validada_por, validada_em, criado_em, pedidos(numero, criado_em), clientes(nome, razao_social)",
      )
      .order("criado_em", { ascending: false }),
    supabase
      .from("pedidos")
      .select(
        "id, numero, total, valor_desconto, valor_acrescimo, subtotal, criado_em, clientes(nome, razao_social, cpf_cnpj, endereco, bairro, cidade, uf, cep), pedido_itens(quantidade, preco_unitario, produtos(nome, ncm, csosn))",
      )
      .eq("status", "faturado")
      .order("criado_em", { ascending: false }),
  ]);

  const notasLista = comoLista<NotaFiscal>(notas);
  const idsComNota = new Set(notasLista.map((n) => n.pedido_id));
  const pendentes = comoLista<PedidoPendenteFiscal>(pedidosFaturados).filter((p) => !idsComNota.has(p.id));

  return <FiscalView notas={notasLista} pendentes={pendentes} />;
}
