// Tipos do módulo de varejo. As views do PDV nunca trazem custo nem margem.

export type SessaoCaixa = {
  sessao_id: string;
  caixa_id: string;
  caixa_nome: string;
  deposito_id: string | null;
  aberta_em: string;
  fundo_troco: number;
  status: string;
};

export type ItemCatalogo = {
  variacao_id: string;
  produto_id: string;
  nome: string;
  categoria: string | null;
  sku: string;
  codigo_barras: string | null;
  atributos: Record<string, string>;
  preco_venda: number;
  preco_minimo: number | null;
  saldo: number;
};

export type Supervisor = { profile_id: string; nome: string };

export type VendaDaSessao = {
  id: string;
  numero: number;
  status: "concluida" | "cancelada";
  subtotal: number;
  desconto_total: number;
  total: number;
  troco: number;
  criada_em: string;
};

export type FormaPagamento = "dinheiro" | "pix" | "debito" | "credito";

export type ItemDaVenda = { variacao_id: string; quantidade: number; preco_unitario: number };
export type PagamentoDaVenda = { forma: FormaPagamento; valor: number; parcelas?: number };

export type DadosDaVenda = {
  sessaoId: string;
  itens: ItemDaVenda[];
  pagamentos: PagamentoDaVenda[];
  idempotencyKey: string;
  clienteNome?: string;
  autorizacaoDescontoId?: string;
  autorizacaoEstoqueId?: string;
};

export type AcaoPrivilegiada = "desconto_abaixo_piso" | "cancelamento_venda" | "estorno_pagamento" | "estoque_negativo";

export type ResultadoAutorizacao = { ok: boolean; motivo?: string; autorizacaoId?: string };

export type ResultadoFechamento = { valor_informado: number; valor_esperado: number; divergencia: number };

export type VariacaoNova = { sku: string; atributos: string; preco_venda: number; preco_minimo: number | null };
