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
  crediario_legado: boolean;
  crediario_autorizado_em: string | null;
  crediario_limite: number | null;
  crediario_status: string;
  contatado_reativacao_em: string | null;
  contatado_reativacao_por: string | null;
};

export type CrediarioLancamento = {
  id: string;
  cliente_id: string;
  pedido_id: string | null;
  valor: number;
  vencimento: string;
  situacao: string;
  pago_em: string | null;
  recibo_numero: string | null;
  criado_em: string;
  clientes: { nome: string } | null;
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
  email: string | null;
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
  // Trolesi Vision AI — único campo sem equivalente nos atributos comerciais
  // do documento mestre; usado pra antiduplicação por metadados.
  tags: string[] | null;
};

export type TipoImagemProduto = "frente" | "verso" | "detalhe" | "outra";

export type ProdutoImagem = {
  id: string;
  produto_id: string;
  tipo: TipoImagemProduto;
  storage_path: string;
  criado_em: string;
};

/**
 * Sugestão estruturada que a IA devolve depois de analisar as fotos (Vision
 * AI, Etapas 2 e 3) — mapeia direto pros atributos comerciais que já existem
 * em `Produto` (tipo_banho/tem_pedra/tem_perola/tamanho/colecao), não uma
 * cópia paralela deles.
 */
export type AnaliseIaProduto = {
  nome: string;
  categoria: string;
  subcategoria: string | null;
  material: string | null;
  cor: string | null;
  tipo_banho: string | null;
  tem_pedra: boolean;
  tem_perola: boolean;
  tamanho: string | null;
  colecao: string | null;
  descricao: string;
  tags: string[];
};

/** Produto do catálogo já cadastrado com uma pontuação de semelhança (Vision AI, Etapa 4). */
export type ProdutoSemelhante = Produto & { pontuacao: number };

/** Lançar venda por foto: o que a IA leu de uma linha da notinha manuscrita.
 * `codigo_peca`/`multiplicador` já nascem com o significado real das colunas
 * do papel pré-impresso (a primeira coluna "Quant." é na verdade o código da
 * peça, "Ref." é o multiplicador) — ver DECISIONS.md 2026-08-10. */
export type ItemNotinha = {
  descricao: string;
  codigo_peca: number | null;
  multiplicador: number | null;
  valor_linha: number | null;
};

export type PagamentoNotinha = { forma: string; valor: number };

export type AnaliseNotinha = {
  cliente: string | null;
  data: string | null;
  itens: ItemNotinha[];
  total: number | null;
  pagamentos: PagamentoNotinha[];
  campos_incertos: string[];
};

export type StatusPedido =
  | "orcamento"
  | "pedido"
  | "faturado"
  | "cancelado"
  | "aguardando_lancamento_gmax"
  | "lancado_gmax";
export type FormaPagamento = "dinheiro" | "pix" | "debito" | "cartao_credito" | "promissoria" | "misto";

export type PagamentoMistoLinha = {
  id: string;
  pedido_id: string;
  forma_pagamento: FormaPagamento;
  valor: number;
  criado_em: string;
};

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

export type StatusExpedicao =
  | "aguardando_separacao"
  | "em_separacao"
  | "pronto_para_envio"
  | "postado"
  | "em_transporte"
  | "entregue"
  | "devolvido"
  | "problema_transporte";

export type Expedicao = {
  id: string;
  pedido_id: string;
  endereco_entrega: string | null;
  destinatario: string | null;
  transportadora: string | null;
  modalidade: string | null;
  custo: number;
  frete_gratis: boolean;
  motivo_frete_gratis: string | null;
  status: StatusExpedicao;
  criado_em: string;
  pedidos: { numero: number; clientes: { nome: string } | null } | null;
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

export type AbatimentoStatus = "avaliando" | "aprovado" | "reprovado" | "vinculado";

export type Abatimento = {
  id: string;
  pedido_id: string | null;
  cliente_id: string;
  material: string | null;
  tipo_peca: string | null;
  marca_presente: boolean;
  danificada: boolean;
  tem_pedra: boolean;
  tem_perola: boolean;
  eh_fita_ou_fio: boolean;
  ultima_colecao: boolean;
  eh_relogio: boolean;
  estado_descricao: string | null;
  motivo_avaliacao: string | null;
  valor_atribuido: number | null;
  status: AbatimentoStatus;
  criado_em: string;
  clientes: { nome: string } | null;
};

export type Garantia = {
  id: string;
  pedido_id: string | null;
  produto_id: string | null;
  cliente_id: string;
  tipo: GarantiaProdutoTipo;
  percentual_descascamento: number | null;
  marca_presente: boolean | null;
  peca_completa: boolean | null;
  partes_faltando: string | null;
  limpeza_realizada: boolean | null;
  sinais_mau_uso: boolean | null;
  alianca: boolean;
  parecer: string | null;
  aprovado: boolean | null;
  justificativa: string | null;
  numero_serie: string | null;
  protocolo_fabricante: string | null;
  status_orient: string | null;
  custo_reparo: number | null;
  criado_em: string;
  clientes: { nome: string } | null;
  produtos: { nome: string } | null;
};

export type ItemCarrinho = {
  // Identifica a linha do carrinho, não o produto — duas linhas podem
  // apontar pro mesmo produto_id (ex: duas correntes iguais no cadastro mas
  // com código/peso de peça diferente cada uma). Chave de UI (React key,
  // edição de quantidade/código, remoção); nunca vai pro servidor.
  linha_id: string;
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
  clientes: {
    nome: string;
    cpf_cnpj: string | null;
    telefone: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
  } | null;
  pedido_itens: {
    quantidade: number;
    preco_unitario: number;
    // Código digitado na hora da venda (× multiplicador = preco_unitario) —
    // null em pedidos antigos, gravados antes desta coluna existir.
    codigo_peca: number | null;
    produtos: { nome: string } | null;
  }[];
  pedido_pagamentos_mistos: { forma_pagamento: FormaPagamento; valor: number }[];
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

export type PermissaoEspecial =
  | "alterar_preco_multiplicador"
  | "informar_cotacao"
  | "conceder_desconto_acima_limite"
  | "liberar_primeira_compra_abaixo_minimo"
  | "liberar_reativacao_abaixo_minimo"
  | "aprovar_valor_abatimento"
  | "aprovar_reprovar_garantia"
  | "criar_excecao_crediario"
  | "receber_crediario"
  | "reabrir_caixa"
  | "cancelar_venda"
  | "estornar_pagamento"
  | "alterar_estoque_manual"
  | "conceder_frete_gratis"
  | "acessar_codigo_interno"
  | "consultar_custo_margem";

export type CotacaoDiaria = {
  id: string;
  material: string;
  valor: number;
  data: string;
  informado_por: string | null;
  criado_em: string;
};

export type PermissaoUsuario = {
  id: string;
  profile_id: string;
  permissao: PermissaoEspecial;
  concedida_por: string | null;
  concedida_em: string;
};

// PDV Eventos (2026-08-13) — estoque e vendas à parte pra evento temporário
// (Agroshow), sem código×multiplicador nem regras comerciais do PDV real.
export type FormaPagamentoEvento = "dinheiro" | "pix" | "cartao_vista" | "cartao_parcelado";

export type ProdutoEvento = {
  id: string;
  codigo_interno: string;
  nome: string;
  preco: number;
  quantidade_estoque: number;
  ativo: boolean;
  criado_em: string;
  foto_url: string | null;
  produto_origem_id: string | null;
};

/** Recorte leve de Produto usado só na busca do modal "Importar do Estoque"
 * (PDV Eventos) — evita puxar as ~40 colunas comerciais de Produto pra uma
 * lista de seleção. */
export type ProdutoParaImportar = {
  id: string;
  nome: string;
  codigo_interno: string | null;
  foto_url: string | null;
  preco: number;
  quantidade_estoque: number;
  ativo: boolean;
};

/** Peça do evento com vínculo ao estoque real (produto_origem_id != null) —
 * usado no modal "Devolução" (Estoque real). */
export type ProdutoEventoVinculado = {
  id: string;
  nome: string;
  codigo_interno: string;
  foto_url: string | null;
  quantidade_estoque: number;
  produto_origem_id: string;
};

export type ItemCarrinhoEvento = {
  linha_id: string;
  produto_evento_id: string;
  nome: string;
  preco_unitario: number;
  quantidade: number;
  estoqueDisponivel: number;
  fotoUrl: string | null;
};

export type VendaEvento = {
  id: string;
  numero: number;
  forma_pagamento: FormaPagamentoEvento;
  numero_parcelas: number;
  subtotal: number;
  valor_desconto: number;
  total: number;
  status: "faturado" | "cancelado";
  criado_em: string;
  cliente_nome: string | null;
  cliente_cpf: string | null;
  cliente_telefone: string | null;
  vendas_evento_itens: {
    nome: string;
    quantidade: number;
    preco_unitario: number;
  }[];
};
