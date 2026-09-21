"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lerMoeda } from "@/lib/dinheiro";
import type {
  AcaoPrivilegiada,
  DadosDaVenda,
  ResultadoAutorizacao,
  ResultadoFechamento,
  VariacaoNova,
} from "@/lib/varejo/tipos";

// Regras de negócio do varejo vivem no banco (functions com guarda de operação, PIN de supervisor,
// custo congelado). Aqui só se chama o RPC e se traduz a mensagem. Nenhuma action informa
// operacao_id: ele vem da sessão (o banco rejeita qualquer tentativa de informá-lo).

type ErroPg = { code?: string; message: string };

const CODIGOS_DE_NEGOCIO = new Set(["P0001", "42501", "23514", "23505", "55000"]);

function mensagem(erro: ErroPg): string {
  if (erro.code === "42501" && /^(permission denied|new row)/i.test(erro.message)) {
    return "Você não tem permissão para esta ação.";
  }
  if (erro.code && CODIGOS_DE_NEGOCIO.has(erro.code)) return erro.message;
  return "Não foi possível concluir. Tente novamente.";
}

function atualizarTelas() {
  revalidatePath("/varejo", "layout");
}

export async function abrirCaixa(caixaId: string, fundoTexto: string): Promise<{ erro?: string }> {
  const fundo = lerMoeda(fundoTexto);
  if (fundo === null || fundo < 0) return { erro: "Informe um fundo de troco válido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("abrir_sessao_caixa", { p_caixa_id: caixaId, p_fundo_troco: fundo });
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return {};
}

export async function registrarMovimentoCaixa(
  tipo: "sangria" | "suprimento",
  sessaoId: string,
  valorTexto: string,
  motivo: string,
): Promise<{ erro?: string }> {
  const valor = lerMoeda(valorTexto);
  if (valor === null || valor <= 0) return { erro: "Informe um valor maior que zero." };
  if (motivo.trim() === "") return { erro: "Informe o motivo." };
  const supabase = await createClient();
  const funcao = tipo === "sangria" ? "registrar_sangria" : "registrar_suprimento";
  const { error } = await supabase.rpc(funcao, { p_sessao_id: sessaoId, p_valor: valor, p_motivo: motivo.trim() });
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return {};
}

/** Fechamento cego: o valor contado vai primeiro; o esperado só volta na resposta. */
export async function fecharCaixa(
  sessaoId: string,
  contadoTexto: string,
): Promise<{ erro?: string; resultado?: ResultadoFechamento }> {
  const contado = lerMoeda(contadoTexto);
  if (contado === null || contado < 0) return { erro: "Informe o valor contado." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fechar_sessao_caixa", { p_sessao_id: sessaoId, p_valor_informado: contado });
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return { resultado: data as ResultadoFechamento };
}

export async function autorizarAcao(
  supervisorId: string,
  pin: string,
  acao: AcaoPrivilegiada,
  alvoId: string | null,
): Promise<ResultadoAutorizacao> {
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, motivo: "pin_invalido" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("autorizar_acao", {
    p_supervisor_id: supervisorId,
    p_pin: pin,
    p_acao: acao,
    p_alvo_id: alvoId,
  });
  if (error || !data) return { ok: false, motivo: "erro" };
  const resposta = data as { ok: boolean; motivo?: string; autorizacao_id?: string };
  return { ok: resposta.ok, motivo: resposta.motivo, autorizacaoId: resposta.autorizacao_id };
}

export async function registrarVenda(dados: DadosDaVenda): Promise<{ erro?: string; vendaId?: string }> {
  if (dados.itens.length === 0) return { erro: "Adicione ao menos um item." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("registrar_venda", {
    p_sessao_id: dados.sessaoId,
    p_itens: dados.itens,
    p_pagamentos: dados.pagamentos,
    p_idempotency_key: dados.idempotencyKey,
    p_cliente_nome: dados.clienteNome?.trim() || null,
    p_cliente_documento: null,
    p_autorizacao_desconto_id: dados.autorizacaoDescontoId ?? null,
  });
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return { vendaId: data as string };
}

export async function cancelarVenda(
  vendaId: string,
  motivo: string,
  autorizacaoId: string,
): Promise<{ erro?: string }> {
  if (motivo.trim() === "") return { erro: "Informe o motivo do cancelamento." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancelar_venda", {
    p_venda_id: vendaId,
    p_motivo: motivo.trim(),
    p_autorizacao_id: autorizacaoId,
  });
  if (error) return { erro: mensagem(error) };
  atualizarTelas();
  return {};
}

export async function definirPinSupervisor(profileId: string, pin: string): Promise<{ erro?: string }> {
  if (!/^\d{4,8}$/.test(pin)) return { erro: "O PIN deve ter de 4 a 8 dígitos." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("definir_pin_supervisor", { p_profile_id: profileId, p_pin: pin });
  if (error) return { erro: mensagem(error) };
  revalidatePath("/varejo/supervisores");
  return {};
}

export async function cadastrarProdutoCatalogo(
  nome: string,
  categoria: string,
  variacoes: VariacaoNova[],
): Promise<{ erro?: string }> {
  if (nome.trim() === "") return { erro: "Informe o nome do produto." };
  if (variacoes.length === 0) return { erro: "O produto precisa de ao menos uma variação." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cadastrar_produto_catalogo", {
    p_nome: nome,
    p_categoria: categoria,
    p_variacoes: variacoes.map((v) => {
      // "tamanho 16, cor ouro" -> {"tamanho":"16","cor":"ouro"}; texto sem chave vira {"variacao": texto}
      const atributos: Record<string, string> = {};
      for (const parte of v.atributos.split(",")) {
        const texto = parte.trim();
        if (texto === "") continue;
        const espaco = texto.indexOf(" ");
        if (espaco > 0) atributos[texto.slice(0, espaco).toLowerCase()] = texto.slice(espaco + 1).trim();
        else atributos.variacao = texto;
      }
      return { sku: v.sku, atributos, preco_venda: v.preco_venda, preco_minimo: v.preco_minimo };
    }),
  });
  if (error) return { erro: mensagem(error) };
  revalidatePath("/varejo/catalogo");
  return {};
}

export async function registrarEntradaEstoque(
  depositoId: string,
  variacaoId: string,
  quantidade: number,
  custoTexto: string,
  observacao: string,
): Promise<{ erro?: string }> {
  const custo = lerMoeda(custoTexto);
  if (custo === null || custo < 0) return { erro: "Informe o custo unitário." };
  if (!Number.isInteger(quantidade) || quantidade <= 0) return { erro: "Informe uma quantidade maior que zero." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_entrada_estoque", {
    p_deposito_id: depositoId,
    p_variacao_id: variacaoId,
    p_quantidade: quantidade,
    p_custo_unitario: custo,
    p_observacao: observacao.trim() || null,
  });
  if (error) return { erro: mensagem(error) };
  revalidatePath("/varejo/catalogo");
  return {};
}

/** Transferência do atacado para o varejo: o custo é calculado pelo banco (multiplicador vigente). */
export async function transferirEstoque(
  itens: { produto_origem_id: string; variacao_destino_id: string; quantidade: number }[],
  vencimentoIso: string,
): Promise<{ erro?: string; numero?: number; total?: number }> {
  if (itens.length === 0) return { erro: "Adicione ao menos um item." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transferir_estoque", {
    p_destino_codigo: "VAREJO",
    p_itens: itens,
    p_vencimento: vencimentoIso || null,
  });
  if (error) return { erro: mensagem(error) };
  const { data: cabecalho } = await supabase.from("transferencias").select("numero, total").eq("id", data as string).maybeSingle();
  revalidatePath("/transferencia");
  return { numero: cabecalho?.numero as number | undefined, total: cabecalho?.total as number | undefined };
}
