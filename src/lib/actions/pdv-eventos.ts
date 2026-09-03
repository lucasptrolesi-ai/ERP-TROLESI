"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemErroSalvar, normalizarCampo } from "./erros";
import { fotoEscolhida, subirFotoProduto } from "./foto-produto";
import { comoLista } from "@/lib/supabase-embed";
import { dataLocalDoTimestamptz, hojeIso } from "@/lib/datas";
import { calcularResumoFechamentoCaixa } from "@/lib/fechamento-caixa-evento";
import type { FechamentoCaixaEvento, FormaPagamentoEvento, MovimentoCaixaEvento, VendaEvento } from "@/lib/types";

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

/** Importa peças do Estoque real pro PDV Eventos — só ajusta quantidade nos
 * dois lados (nunca exclui nada); se a peça já foi importada antes, soma na
 * mesma linha do evento (produto_origem_id) em vez de duplicar. Toda a
 * lógica/trava de concorrência vive em importar_produto_evento (migration
 * 20260824000001, SECURITY DEFINER) — mesmo motivo de criar_venda_evento
 * não ser um insert direto: estoque real, estoque do evento e o registro de
 * auditoria sempre precisam andar juntos. */
export async function importarProdutoEstoque(
  produtoId: string,
  quantidade: number,
  preco: number | null,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("importar_produto_evento", {
    p_produto_id: produtoId,
    p_quantidade: quantidade,
    p_preco: preco,
  });
  if (error) return { erro: error.message };

  revalidatePath("/pdv-eventos");
  revalidatePath("/estoque");
  return {};
}

/** Devolve peças do evento pro Estoque real — só peças com produto_origem_id
 * (vieram de uma importação). Ver devolver_produto_evento (mesma migration)
 * pra trava de concorrência e validação. */
export async function devolverProdutoEstoque(
  produtoEventoId: string,
  quantidade: number,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("devolver_produto_evento", {
    p_produto_evento_id: produtoEventoId,
    p_quantidade: quantidade,
  });
  if (error) return { erro: error.message };

  revalidatePath("/pdv-eventos");
  revalidatePath("/estoque");
  return {};
}

/** Cadastro simples de cupom de desconto do PDV Eventos (pedido do usuário,
 * 2026-09-03) — código, tipo (percentual/valor) e valor; ativo/inativo em
 * vez de excluir, mesmo padrão do resto do módulo. */
export async function salvarCupomEvento(_prev: ResultadoForm, formData: FormData): Promise<ResultadoForm> {
  const codigo = normalizarCampo(formData.get("codigo"), { caixaAlta: true });
  if (!codigo) return { erro: "Código é obrigatório." };
  const tipo = formData.get("tipo") === "percentual" ? "percentual" : "valor";
  const valor = numeroOuZero(formData.get("valor"));
  if (valor <= 0) return { erro: "Valor precisa ser maior que zero." };
  if (tipo === "percentual" && valor > 100) return { erro: "Percentual não pode passar de 100." };

  const supabase = await createClient();
  const id = normalizarCampo(formData.get("id"));
  const dados = { codigo, tipo, valor, ativo: formData.get("ativo") === "on" };

  const { error } = id
    ? await supabase.from("cupons_evento").update(dados).eq("id", id)
    : await supabase.from("cupons_evento").insert(dados);

  if (error) return { erro: mensagemErroSalvar(error, "código") };

  revalidatePath("/pdv-eventos");
  return undefined;
}

/** Entrada de peça de ouro (pedido direto do usuário, 2026-09-01): digita o
 * código, o preço sai sozinho (peso × cotação do dia × 1,30 — mesma
 * cotação usada no Estoque real, ver tela "Cotação"). Código já existente
 * reaproveita o peso salvo (ignora p_peso); código novo exige nome+peso.
 * Toda a lógica/trava de concorrência vive em entrada_ouro_evento
 * (migration 20260901000002, SECURITY DEFINER). */
export async function entradaOuroEvento(
  codigoInterno: string,
  quantidade: number,
  data: string,
  nome: string | null,
  peso: number | null,
): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("entrada_ouro_evento", {
    p_codigo_interno: codigoInterno,
    p_quantidade: quantidade,
    p_data: data,
    p_nome: nome,
    p_peso: peso,
  });
  if (error) return { erro: error.message };

  revalidatePath("/pdv-eventos");
  return {};
}

/** Entrada ou retirada de dinheiro do caixa (pedido do usuário, 2026-09-03)
 * — só insert, mesmo espírito de movimentacoes_estoque_evento: registro de
 * auditoria, não um valor editável livremente depois. */
export async function registrarMovimentoCaixaEvento(
  tipo: "entrada" | "retirada",
  valor: number,
  motivo: string,
): Promise<{ erro?: string }> {
  if (!Number.isFinite(valor) || valor <= 0) return { erro: "Valor precisa ser maior que zero." };
  if (!motivo.trim()) return { erro: `Informe o motivo da ${tipo === "entrada" ? "entrada" : "retirada"}.` };

  const supabase = await createClient();
  const { error } = await supabase.from("movimentos_caixa_evento").insert({ tipo, valor, motivo: motivo.trim() });
  if (error) return { erro: error.message };

  revalidatePath("/pdv-eventos");
  return {};
}

/** Valor com que o caixa abriu hoje (troco inicial) — chamada de novo
 * corrige (sempre usa a mais recente do dia, ver fecharCaixaEvento). */
export async function registrarAberturaCaixaEvento(valor: number): Promise<{ erro?: string }> {
  if (!Number.isFinite(valor) || valor < 0) return { erro: "Valor precisa ser zero ou maior." };

  const supabase = await createClient();
  const { error } = await supabase.from("aberturas_caixa_evento").insert({ data: hojeIso(), valor });
  if (error) return { erro: error.message };

  revalidatePath("/pdv-eventos");
  return {};
}

/** Fecha o caixa de HOJE (pedido do usuário, 2026-09-03): recalcula o
 * resumo no servidor a partir das vendas faturadas, movimentos e abertura
 * do dia (não confia em soma feita no cliente) e grava uma linha de
 * histórico. `valorContado` é a contagem física da gaveta (opcional — null
 * pula a conferência) — a diferença fica gravada junto, não só calculada
 * na hora de exibir. A impressão em si é uma solicitação separada
 * (solicitarImpressaoCupom, construirLinhasFechamentoCaixa) — esta action
 * só garante o número certo gravado, chamada de novo a cada "Fechar caixa"
 * (sem trava de uma vez por dia: evento ao vivo, mais seguro poder refazer
 * que travar). */
export async function fecharCaixaEvento(
  valorContado: number | null,
): Promise<{ fechamento: FechamentoCaixaEvento; movimentos: MovimentoCaixaEvento[] } | { erro: string }> {
  const supabase = await createClient();
  const hoje = hojeIso();

  const [
    { data: vendas, error: erroVendas },
    { data: movimentos, error: erroMovimentos },
    { data: aberturas, error: erroAberturas },
  ] = await Promise.all([
    supabase.from("vendas_evento").select("forma_pagamento, total, valor_desconto, criado_em").eq("status", "faturado"),
    supabase.from("movimentos_caixa_evento").select("*, profiles(nome)").order("criado_em", { ascending: true }),
    supabase.from("aberturas_caixa_evento").select("valor, criado_em").eq("data", hoje).order("criado_em", { ascending: false }),
  ]);
  if (erroVendas) return { erro: erroVendas.message };
  if (erroMovimentos) return { erro: erroMovimentos.message };
  if (erroAberturas) return { erro: erroAberturas.message };

  const vendasHoje = (vendas ?? []).filter((v) => dataLocalDoTimestamptz(v.criado_em) === hoje);
  const movimentosHoje = ((movimentos ?? []) as MovimentoCaixaEvento[]).filter(
    (m) => dataLocalDoTimestamptz(m.criado_em) === hoje,
  );
  const valorAbertura = aberturas?.[0]?.valor ?? 0;
  const resumo = calcularResumoFechamentoCaixa(vendasHoje, movimentosHoje, valorAbertura);
  const diferenca = valorContado != null ? Math.round((valorContado - resumo.saldoDinheiro) * 100) / 100 : null;

  const { data: fechamento, error: erroInsert } = await supabase
    .from("fechamentos_caixa_evento")
    .insert({
      data: hoje,
      valor_abertura: resumo.valorAbertura,
      total_dinheiro: resumo.porFormaPagamento.dinheiro,
      total_pix: resumo.porFormaPagamento.pix,
      total_cartao_vista: resumo.porFormaPagamento.cartao_vista,
      total_cartao_parcelado: resumo.porFormaPagamento.cartao_parcelado,
      total_descontos: resumo.totalDescontos,
      total_entradas: resumo.totalEntradas,
      total_retiradas: resumo.totalRetiradas,
      saldo_dinheiro: resumo.saldoDinheiro,
      valor_contado: valorContado,
      diferenca,
    })
    .select("*, profiles(nome)")
    .single();
  if (erroInsert || !fechamento) return { erro: erroInsert?.message ?? "Não foi possível fechar o caixa." };

  revalidatePath("/pdv-eventos");
  return { fechamento, movimentos: movimentosHoje };
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

/** Extorna uma venda do evento — devolve a quantidade de cada item pro
 * estoque do evento e marca como 'cancelado' (para de aparecer no Resumo,
 * que só lista 'faturado'). Toda a lógica/trava de concorrência vive em
 * extornar_venda_evento (migration 20260828000001, SECURITY DEFINER). */
export async function extornarVendaEvento(vendaId: string): Promise<{ erro?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("extornar_venda_evento", { p_venda_id: vendaId });
  if (error) return { erro: error.message };

  revalidatePath("/pdv-eventos");
  return {};
}
