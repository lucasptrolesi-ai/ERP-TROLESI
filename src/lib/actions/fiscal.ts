"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { cfopPadrao, gerarXmlConferencia, type DadosNfe } from "@/lib/nfe";
import { comoTimestamptzBrasilia, hojeIso } from "@/lib/datas";
import type { PedidoPendenteFiscal } from "@/lib/types";

function montarDadosNfe(
  pedido: PedidoPendenteFiscal,
  cfop: string,
  naturezaOperacao: string,
  serie: string,
): DadosNfe {
  return {
    numeroPedido: pedido.numero,
    serie,
    naturezaOperacao,
    cfop,
    dataEmissao: comoTimestamptzBrasilia(hojeIso()),
    cliente: {
      nome: pedido.clientes!.nome,
      razaoSocial: pedido.clientes!.razao_social,
      cpfCnpj: pedido.clientes!.cpf_cnpj,
      endereco: pedido.clientes!.endereco,
      bairro: pedido.clientes!.bairro,
      cidade: pedido.clientes!.cidade,
      uf: pedido.clientes!.uf,
      cep: pedido.clientes!.cep,
    },
    itens: pedido.pedido_itens.map((item) => ({
      nome: item.produtos?.nome ?? "Produto",
      ncm: item.produtos?.ncm ?? null,
      csosn: item.produtos?.csosn ?? "101",
      quantidade: item.quantidade,
      precoUnitario: item.preco_unitario,
    })),
    subtotal: pedido.subtotal,
    desconto: pedido.valor_desconto,
    acrescimo: pedido.valor_acrescimo,
    total: pedido.total,
  };
}

async function buscarPedidoPendente(pedidoId: string): Promise<PedidoPendenteFiscal | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pedidos")
    .select(
      "id, numero, total, valor_desconto, valor_acrescimo, subtotal, criado_em, clientes(nome, razao_social, cpf_cnpj, endereco, bairro, cidade, uf, cep), pedido_itens(quantidade, preco_unitario, produtos(nome, ncm, csosn))",
    )
    .eq("id", pedidoId)
    .single();
  return (data as unknown as PedidoPendenteFiscal) ?? null;
}

export async function gerarNotaFiscal(pedidoId: string): Promise<{ erro?: string; notaId?: string }> {
  const pedido = await buscarPedidoPendente(pedidoId);
  if (!pedido) return { erro: "Pedido não encontrado." };
  if (!pedido.clientes) return { erro: "Pedido sem cliente vinculado." };

  const supabase = await createClient();

  const { data: existente } = await supabase
    .from("notas_fiscais")
    .select("id")
    .eq("pedido_id", pedidoId)
    .maybeSingle();
  if (existente) return { erro: "Esse pedido já tem uma nota gerada." };

  const { data: clienteRow } = await supabase.from("pedidos").select("cliente_id").eq("id", pedidoId).single();
  if (!clienteRow) return { erro: "Pedido não encontrado." };

  const cfop = cfopPadrao(pedido.clientes.uf);
  const naturezaOperacao = "Venda de mercadoria";
  const serie = "1";

  const xml = gerarXmlConferencia(montarDadosNfe(pedido, cfop, naturezaOperacao, serie));

  const { data: nota, error } = await supabase
    .from("notas_fiscais")
    .insert({
      pedido_id: pedidoId,
      cliente_id: clienteRow.cliente_id,
      status: "gerada",
      xml,
      valor_total: pedido.total,
      cfop,
      natureza_operacao: naturezaOperacao,
      serie,
    })
    .select("id")
    .single();

  if (error || !nota) return { erro: "Não foi possível gerar a nota. Tente novamente." };

  revalidatePath("/fiscal");
  return { notaId: nota.id as string };
}

export async function atualizarDadosFiscais(
  notaId: string,
  dados: { cfop: string; naturezaOperacao: string },
): Promise<{ erro?: string }> {
  const supabase = await createClient();

  const { data: nota } = await supabase.from("notas_fiscais").select("pedido_id, status").eq("id", notaId).single();
  if (!nota) return { erro: "Nota não encontrada." };
  if (nota.status !== "gerada") return { erro: "Só é possível editar notas ainda em conferência." };

  const pedido = await buscarPedidoPendente(nota.pedido_id);
  if (!pedido || !pedido.clientes) return { erro: "Pedido não encontrado." };

  const xml = gerarXmlConferencia(montarDadosNfe(pedido, dados.cfop, dados.naturezaOperacao, "1"));

  const { error } = await supabase
    .from("notas_fiscais")
    .update({ cfop: dados.cfop, natureza_operacao: dados.naturezaOperacao, xml, atualizado_em: new Date().toISOString() })
    .eq("id", notaId);

  if (error) return { erro: "Não foi possível atualizar. Tente novamente." };

  revalidatePath("/fiscal");
  return {};
}

export async function marcarComoValidada(notaId: string): Promise<{ erro?: string }> {
  const perfil = await getPerfilAtual();
  const supabase = await createClient();

  const { data: atualizada, error } = await supabase
    .from("notas_fiscais")
    .update({ status: "validada", validada_por: perfil.id, validada_em: new Date().toISOString() })
    .eq("id", notaId)
    .eq("status", "gerada")
    .select("id");

  if (error) return { erro: "Não foi possível marcar como validada. Tente novamente." };
  if (!atualizada || atualizada.length === 0) {
    return { erro: "Essa nota já não está mais em conferência — recarregue a página." };
  }

  revalidatePath("/fiscal");
  return {};
}
