import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { getContextoSessao } from "@/lib/supabase/contexto";
import { CrediarioVarejoView } from "./crediario-varejo-view";
import type { ContaReceberVarejo } from "@/lib/varejo/tipos";

// Venda fiado/a prazo (2026-10-28): lista as parcelas lançadas pelo PDV (contas_receber.venda_id
// preenchido -- nunca pedido_id, esse é o Atacado) e deixa marcar como pago. Reaproveita
// `contas_receber`/`dar_baixa_em_lote_contas_receber` do Atacado (já são genéricos, não presos a
// nenhuma operação) em vez de duplicar -- só a tela é nova.
export default async function CrediarioVarejoPage() {
  const perfil = await getPerfilAtual();
  const contexto = await getContextoSessao();

  if (perfil.papel !== "admin") {
    return <Aviso texto="O crediário do Varejo é restrito a administradores." />;
  }
  if (contexto?.operacao_codigo !== "VAREJO" && !contexto?.dono) {
    return <Aviso texto="Troque para a operação Varejo (seletor no topo) para acessar o crediário." />;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("contas_receber")
    .select("id, venda_id, cliente_id, valor, vencimento, situacao, pago_em, numero_parcela, total_parcelas, clientes(nome, cpf_cnpj), vendas(numero)")
    .not("venda_id", "is", null)
    .order("vencimento");

  const parcelas: ContaReceberVarejo[] = (data ?? []).map((r) => {
    const cliente = r.clientes as unknown as { nome: string; cpf_cnpj: string | null } | null;
    const venda = r.vendas as unknown as { numero: number } | null;
    return {
      id: r.id,
      venda_id: r.venda_id as string,
      cliente_id: r.cliente_id,
      valor: r.valor,
      vencimento: r.vencimento,
      situacao: r.situacao,
      pago_em: r.pago_em,
      numero_parcela: r.numero_parcela,
      total_parcelas: r.total_parcelas,
      cliente_nome: cliente?.nome ?? "—",
      cliente_documento: cliente?.cpf_cnpj ?? null,
      venda_numero: venda?.numero ?? 0,
    };
  });

  return <CrediarioVarejoView parcelas={parcelas} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">{texto}</div>
  );
}
