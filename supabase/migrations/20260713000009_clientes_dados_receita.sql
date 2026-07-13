-- Fase 4: guarda a ficha completa retornada pela busca de CNPJ (Receita
-- Federal). "nome" continua sendo o nome de exibição/busca — passa a ser
-- preenchido com a razão social (nome legal), não o nome fantasia, quando
-- vem de uma busca automática.

alter table public.clientes
  add column razao_social text,
  add column nome_fantasia text,
  add column situacao_cadastral text,
  add column data_abertura date,
  add column natureza_juridica text,
  add column porte text,
  add column atividade_principal text;
