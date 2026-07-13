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
