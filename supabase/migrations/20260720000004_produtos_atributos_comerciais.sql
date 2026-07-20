-- Fase 2 (documento mestre, seção 17): estende `produtos` com os atributos
-- comerciais que alimentam desconto/abatimento/garantia/primeira compra/
-- consignado futuro. Só ADITIVO — nenhuma coluna existente muda de tipo ou
-- é removida; toda coluna nova é opcional (nullable ou com default seguro),
-- então nenhuma linha real dos 44 produtos já migrados quebra.
--
-- ROLLBACK:
-- alter table public.produtos
--   drop column if exists codigo_barras,
--   drop column if exists referencia,
--   drop column if exists descricao,
--   drop column if exists material,
--   drop column if exists tipo_banho,
--   drop column if exists tem_pedra,
--   drop column if exists tem_perola,
--   drop column if exists tem_resina,
--   drop column if exists eh_fita,
--   drop column if exists eh_fio,
--   drop column if exists eh_correntaria,
--   drop column if exists eh_fornitura,
--   drop column if exists eh_embalagem,
--   drop column if exists eh_relogio,
--   drop column if exists colecao,
--   drop column if exists ultima_colecao,
--   drop column if exists cor,
--   drop column if exists tamanho,
--   drop column if exists peso,
--   drop column if exists genero,
--   drop column if exists garantia_tipo,
--   drop column if exists marca_gravada,
--   drop column if exists fornecedor_id,
--   drop column if exists custo_aquisicao,
--   drop column if exists usa_cotacao_diaria,
--   drop column if exists preco_promocional,
--   drop column if exists cest,
--   drop column if exists cfop_padrao,
--   drop column if exists cst,
--   drop column if exists origem_mercadoria;
-- drop type if exists public.garantia_produto_tipo;

create type public.garantia_produto_tipo as enum (
  'sem_garantia', 'folheado_ouro', 'autenticidade_prata_aco', 'orient'
);

alter table public.produtos
  add column codigo_barras text,
  add column referencia text,
  add column descricao text,
  -- Texto livre (não enum): materiais podem crescer sem exigir migration
  -- nova; as regras de negócio que dependem de material específico (Fase 3
  -- desconto, Fase 4 abatimento/garantia) comparam por texto conhecido
  -- ("prata 925", "folheado a ouro" etc.), documentado nos módulos que usam.
  add column material text,
  add column tipo_banho text,
  add column tem_pedra boolean not null default false,
  add column tem_perola boolean not null default false,
  add column tem_resina boolean not null default false,
  add column eh_fita boolean not null default false,
  add column eh_fio boolean not null default false,
  add column eh_correntaria boolean not null default false,
  -- Crítico pra Fase 3 (desconto): fornitura nunca recebe desconto.
  add column eh_fornitura boolean not null default false,
  add column eh_embalagem boolean not null default false,
  -- Crítico pra Fase 4 (garantia Orient): só relógio segue esse fluxo.
  add column eh_relogio boolean not null default false,
  add column colecao text,
  -- Crítico pra Fase 4 (abatimento): peça de última coleção é inelegível.
  add column ultima_colecao boolean not null default false,
  add column cor text,
  add column tamanho text,
  add column peso numeric(10, 3),
  add column genero text,
  -- Crítico pra Fase 4 (qual fluxo de garantia se aplica ao produto).
  add column garantia_tipo public.garantia_produto_tipo not null default 'sem_garantia',
  -- Crítico pra Fase 4 (garantia/abatimento: peça sem marca é tratada
  -- diferente — abatimento rejeita, garantia de folheado exige marca).
  add column marca_gravada boolean not null default true,
  add column fornecedor_id uuid references public.fornecedores (id) on delete set null,
  -- Distinto de `codigo_peca` (que é a base × multiplicador = preço de
  -- venda) — este é o custo real de aquisição, usado só pra margem
  -- (permissão `consultar_custo_margem`, seção 25), nunca pro cálculo de
  -- preço de venda.
  add column custo_aquisicao numeric(10, 2),
  add column usa_cotacao_diaria boolean not null default false,
  add column preco_promocional numeric(10, 2),
  add column cest text,
  add column cfop_padrao text,
  add column cst text,
  add column origem_mercadoria text not null default '0';
