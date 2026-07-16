-- Fiscal/NF-e em modo conferência: produtos precisam de NCM/CSOSN pra montar
-- o XML, e notas_fiscais (já criada na Fase 2) ganha os campos que faltavam
-- pra gerar o documento (CFOP, natureza da operação, série).

alter table public.produtos
  add column ncm text,
  add column csosn text not null default '101';

alter table public.notas_fiscais
  add column cfop text not null default '5101',
  add column natureza_operacao text not null default 'Venda de mercadoria',
  add column serie text not null default '1';
