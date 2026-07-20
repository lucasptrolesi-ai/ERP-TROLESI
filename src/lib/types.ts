export type Cliente = {
  id: string;
  nome: string;
  cpf_cnpj: string | null;
  telefone: string | null;
  email: string | null;
  data_nascimento: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  cep: string | null;
  endereco: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  data_abertura: string | null;
  natureza_juridica: string | null;
  porte: string | null;
  atividade_principal: string | null;
  ativo: boolean;
};

export type Fornecedor = {
  id: string;
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
};

export type Funcionario = {
  id: string;
  nome: string;
  papel: string;
  ativo: boolean;
};

export type GarantiaProdutoTipo = "sem_garantia" | "folheado_ouro" | "autenticidade_prata_aco" | "orient";

export type Produto = {
  id: string;
  nome: string;
  categoria: string;
  subcategoria: string | null;
  subsubcategoria: string | null;
  foto_url: string | null;
  codigo_interno: string | null;
  codigo_peca: number;
  multiplicador: number;
  preco: number;
  quantidade_estoque: number;
  estoque_minimo: number;
  ncm: string | null;
  csosn: string;
  ativo: boolean;
  // Atributos comerciais — seção 17 do documento mestre.
  codigo_barras: string | null;
  referencia: string | null;
  descricao: string | null;
  material: string | null;
  tipo_banho: string | null;
  tem_pedra: boolean;
  tem_perola: boolean;
  tem_resina: boolean;
  eh_fita: boolean;
  eh_fio: boolean;
  eh_correntaria: boolean;
  eh_fornitura: boolean;
  eh_embalagem: boolean;
  eh_relogio: boolean;
  colecao: string | null;
  ultima_colecao: boolean;
  cor: string | null;
  tamanho: string | null;
  peso: number | null;
  genero: string | null;
  garantia_tipo: GarantiaProdutoTipo;
  marca_gravada: boolean;
  fornecedor_id: string | null;
  custo_aquisicao: number | null;
  usa_cotacao_diaria: boolean;
  preco_promocional: number | null;
  cest: string | null;
  cfop_padrao: string | null;
  cst: string | null;
  origem_mercadoria: string;
  localizacao_id: string | null;
};

export type StatusPedido =
  | "orcamento"
  | "pedido"
  | "faturado"
  | "cancelado"
  | "aguardando_lancamento_gmax"
  | "lancado_gmax";
export type FormaPagamento = "dinheiro" | "pix" | "debito" | "cartao_credito" | "promissoria";

export type EventoComissao = "venda" | "recebimento" | "fechamento_mensal";

export type Vendedor = {
  id: string;
  profile_id: string;
  comissao_percentual: number | null;
  comissao_fixa: number | null;
  evento_gerador: EventoComissao;
  meta_mensal: number | null;
  ativo: boolean;
};

export type CondicaoPagamento = {
  id: string;
  forma_pagamento: FormaPagamento;
  valor_minimo_venda: number;
  parcelas_maximas_sem_juros: number;
  parcelas_maximas_com_juros: number;
  valor_minimo_parcela: number;
  ativo: boolean;
};

export type LocalEstoque = {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
};

export type FaixaParcelamentoDb = {
  forma_pagamento: FormaPagamento;
  valor_minimo: number;
  parcelas_sem_juros: number;
};

export type EstatisticasCliente = {
  data_primeira_compra: string | null;
  data_ultima_compra: string | null;
  total_comprado: number;
  meses_inatividade: number | null;
};

export type ItemCarrinho = {
  produto_id: string;
  nome: string;
  quantidade: number;
  codigo_peca: number;
  multiplicador: number;
  preco_unitario: number; // codigo_peca * multiplicador — editável via código, não digitado direto
  estoqueDisponivel: number;
};

export type Parcela = {
  valor: number;
  vencimento: string; // "AAAA-MM-DD"
};

export type Pedido = {
  id: string;
  numero: number;
  status: StatusPedido;
  forma_pagamento: FormaPagamento | null;
  subtotal: number;
  valor_desconto: number;
  percentual_desconto: number | null;
  valor_acrescimo: number;
  percentual_acrescimo: number | null;
  numero_parcelas: number;
  total: number;
  criado_em: string;
  parcelas_planejadas: Parcela[] | null;
  lancado_gmax_em: string | null;
  clientes: { nome: string; cpf_cnpj: string | null; endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null } | null;
  pedido_itens: { quantidade: number; preco_unitario: number; produtos: { nome: string } | null }[];
};

export type ContaReceber = {
  id: string;
  valor: number;
  vencimento: string;
  numero_parcela: number | null;
  total_parcelas: number | null;
};

export type SituacaoConta = "em_dia" | "atrasado" | "pago";

export type ContaReceberFinanceiro = {
  id: string;
  cliente_id: string | null;
  pedido_id: string | null;
  valor: number;
  vencimento: string;
  situacao: SituacaoConta;
  pago_em: string | null;
  forma_pagamento: FormaPagamento | null;
  valor_pago: number | null;
  forma_pagamento_baixa: FormaPagamento | null;
  observacao_baixa: string | null;
  numero_parcela: number | null;
  total_parcelas: number | null;
  clientes: { nome: string } | null;
  pedidos: { numero: number } | null;
};

export type ParcelaVencendo = {
  id: string;
  valor: number;
  vencimento: string;
  clientes: { nome: string; telefone: string | null } | null;
  pedidos: { numero: number } | null;
};

export type ContaPagarVencendo = {
  id: string;
  valor: number;
  vencimento: string;
  descricao: string;
  fornecedores: { nome: string } | null;
};

export type ContaPagar = {
  id: string;
  fornecedor_id: string | null;
  descricao: string;
  valor: number;
  vencimento: string;
  situacao: SituacaoConta;
  pago_em: string | null;
  valor_pago: number | null;
  forma_pagamento_baixa: FormaPagamento | null;
  observacao_baixa: string | null;
  fornecedores: { nome: string } | null;
};

export type StatusNotaFiscal = "rascunho" | "gerada" | "validada" | "autorizada" | "cancelada";

export type NotaFiscal = {
  id: string;
  pedido_id: string;
  cliente_id: string;
  status: StatusNotaFiscal;
  xml: string | null;
  chave_acesso: string | null;
  protocolo: string | null;
  valor_total: number;
  cfop: string;
  natureza_operacao: string;
  serie: string;
  validada_por: string | null;
  validada_em: string | null;
  criado_em: string;
  pedidos: { numero: number; criado_em: string } | null;
  clientes: { nome: string; razao_social: string | null } | null;
};

/** Pedido faturado ainda sem nota — usado na lista "pendentes de emissão". */
export type PedidoPendenteFiscal = {
  id: string;
  numero: number;
  total: number;
  valor_desconto: number;
  valor_acrescimo: number;
  subtotal: number;
  criado_em: string;
  clientes: {
    nome: string;
    razao_social: string | null;
    cpf_cnpj: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  } | null;
  pedido_itens: {
    quantidade: number;
    preco_unitario: number;
    produtos: { nome: string; ncm: string | null; csosn: string } | null;
  }[];
};
