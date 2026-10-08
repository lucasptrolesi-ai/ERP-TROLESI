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
  valorDesconto?: number;
  valorAcrescimo?: number;
};

export type AcaoPrivilegiada = "desconto_abaixo_piso" | "cancelamento_venda" | "estorno_pagamento" | "estoque_negativo";

export type ResultadoAutorizacao = { ok: boolean; motivo?: string; autorizacaoId?: string };

export type ResultadoFechamento = { valor_informado: number; valor_esperado: number; divergencia: number };

export type VariacaoNova = { sku: string; atributos: string; preco_venda: number; preco_minimo: number | null };

// --- Controle Financeiro do Varejo ----------------------------------------------------------------

export type ConfigFinanceira = {
  id: string;
  vigente_desde: string;
  fator_venda_padrao: number;
  fator_venda_min: number;
  fator_venda_max: number;
  despesas_variaveis_pct: number;
  lucro_desejado_pct: number;
  dias_abertos_mes: number;
  encargos_clt_pct: number;
  caixa_inicial: number;
  mes_abertura: string;
  preco_piso_entrada: number;
  arredondar_90: boolean;
};

export type GastoVarejo = {
  id: string;
  descricao: string;
  tipo: "mensal" | "compra";
  valor: number;
  mes_inicio: string;
  mes_fim: string | null;
  parcelas: number | null;
};

export type MembroEquipeVarejo = {
  id: string;
  nome: string;
  salario: number;
  somar_encargos: boolean;
  mes_inicio: string;
  mes_fim: string | null;
};

export type MovimentoCaixaVarejo = { id: string; data: string; tipo: "entrada" | "saida"; descricao: string; valor: number };

export type InvestimentoInicialVarejo = { id: string; data: string; descricao: string; valor: number };

export type VendaManualVarejo = {
  id: string;
  data: string;
  faturamento: number;
  numero_vendas: number;
  origem: "manual" | "importacao";
};

export type LinhaCatalogo = {
  variacao_id: string;
  produto_id: string;
  produto_nome: string;
  categoria: string | null;
  sku: string;
  atributos: Record<string, string>;
  preco_venda: number;
  preco_minimo: number | null;
  foto_url: string | null;
  localizacao: Record<string, string>;
  ativo: boolean;
};
