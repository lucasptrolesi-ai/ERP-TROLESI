"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, normalizarCampo } from "./erros";
import { fotoEscolhida, subirFotoProduto } from "./foto-produto";
import { comoLista } from "@/lib/supabase-embed";
import type { FormaPagamentoEvento, VendaEvento } from "@/lib/types";

type ResultadoForm = { erro?: string } | undefined;

function numeroOuZero(valor: FormDataEntryValue | null): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Cadastro simples do estoque de evento — preço digitado direto, sem
 * código×multiplicador. codigo_interno agora é digitável (esquema do
 * usuário: prefixo de letra por categoria + sequencial, ex: CA00, CP01) —
 * em branco, o trigger definir_codigo_produto_evento (migration
 * 20260813000001) ainda atribui o próximo número sequencial sozinho. */
export async function salvarProdutoEvento(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const nome = normalizarCampo(formData.get("nome"), { caixaAlta: true });
  if (!nome) return { erro: "Nome é obrigatório." };
  const codigoInterno = normalizarCampo(formData.get("codigo_interno"), { caixaAlta: true });

  const supabase = await createClient();
  const arquivoFoto = fotoEscolhida(formData);
  let fotoUrl = normalizarCampo(formData.get("foto_url_atual"));
  if (arquivoFoto) {
    const resultado = await subirFotoProduto(supabase, arquivoFoto, "evento");
    if (resultado.erro) return { erro: resultado.erro };
    fotoUrl = resultado.url ?? fotoUrl;
  }

  const id = normalizarCampo(formData.get("id"));
  const dados = {
    nome,
    preco: Math.max(0, numeroOuZero(formData.get("preco"))),
    quantidade_estoque: Math.max(0, Math.trunc(numeroOuZero(formData.get("quantidade_estoque")))),
    ativo: formData.get("ativo") === "on",
    foto_url: fotoUrl,
    // Em branco numa peça NOVA vira null — o trigger gera o próximo número
    // sozinho (codigo_interno é NOT NULL, sem trigger de update). Em branco
    // numa EDIÇÃO não pode virar null (violaria a constraint), então
    // simplesmente não entra no payload — mantém o código já salvo.
    ...(codigoInterno || !id ? { codigo_interno: codigoInterno } : {}),
  };

  const { error } = id
    ? await supabase.from("produtos_evento").update(dados).eq("id", id)
    : await supabase.from("produtos_evento").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error, "código") };

  revalidatePath("/pdv-eventos");
  return undefined;
}

/** Só leitura — usada pelo painel de metas (painel-metas.tsx) pra atualizar
 * sozinho a cada 60s sem depender de um F5. Mesma query/filtro de
 * page.tsx — nunca altera nada, sem risco pro estoque/dados existentes. */
export async function buscarVendasEvento(): Promise<{ vendas: VendaEvento[] } | { erro: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendas_evento")
    .select("*, vendas_evento_itens(nome, quantidade, preco_unitario)")
    .eq("status", "faturado")
    .order("criado_em", { ascending: false });

  if (error) return { erro: error.message };
  return { vendas: comoLista<VendaEvento>(data) };
}

export async function excluirProdutoEvento(id: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  // vendas_evento_itens.produto_evento_id é "on delete set null" (não
  // restrict) de propósito — excluir uma peça de evento nunca é bloqueado
  // por venda vinculada, só desvincula o histórico. Por isso não usa
  // mensagemErroExcluir aqui: o branch de FK dela (código 23503) nunca
  // dispara pra essa tabela, e mencionar "vendas vinculadas" induziria a
  // pensar que existe um bloqueio que não existe (achado de code review).
  const { error } = await supabase.from("produtos_evento").delete().eq("id", id);
  if (error) return { erro: "Não foi possível excluir. Tente novamente." };

  revalidatePath("/pdv-eventos");
  return {};
}

export async function registrarVendaEvento(
  itens: { produto_evento_id: string; nome: string; quantidade: number; preco_unitario: number }[],
  formaPagamento: FormaPagamentoEvento,
  valorDesconto: number,
  numeroParcelas: number,
  idempotencyKey: string,
  clienteNome: string | null,
  clienteCpf: string | null,
  clienteTelefone: string | null,
): Promise<{ erro?: string; venda?: { id: string; numero: number; criado_em: string } }> {
  if (itens.length === 0) return { erro: "Adicione pelo menos uma peça à venda." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("criar_venda_evento", {
    p_itens: itens,
    p_forma_pagamento: formaPagamento,
    p_valor_desconto: valorDesconto,
    p_numero_parcelas: numeroParcelas,
    p_idempotency_key: idempotencyKey,
    p_cliente_nome: clienteNome,
    p_cliente_cpf: clienteCpf,
    p_cliente_telefone: clienteTelefone,
  });

  if (error) return { erro: error.message };

  // criar_venda_evento só devolve o id (uuid) — numero/criado_em são
  // atribuídos pelo próprio insert dentro da function, então precisam de
  // uma leitura extra pra voltar pro cupom (numeração sequencial e
  // timestamp exatos, não recalculados no cliente).
  const { data: venda, error: erroVenda } = await supabase
    .from("vendas_evento")
    .select("id, numero, criado_em")
    .eq("id", data)
    .single();
  if (erroVenda || !venda) return { erro: "Venda registrada, mas não foi possível carregar os dados pro cupom." };

  revalidatePath("/pdv-eventos");
  return { venda };
}
