-- Índices faltando em foreign key das tabelas do PDV Eventos (achado do
-- advisor de performance do Supabase, 2026-08-17) — sem índice, qualquer
-- join/lookup por essas colunas faz sequential scan.
--
-- ROLLBACK:
-- drop index if exists public.vendas_evento_criado_por_idx;
-- drop index if exists public.vendas_evento_itens_produto_evento_id_idx;
-- drop index if exists public.vendas_evento_itens_venda_id_idx;

create index vendas_evento_criado_por_idx on public.vendas_evento (criado_por);
create index vendas_evento_itens_produto_evento_id_idx on public.vendas_evento_itens (produto_evento_id);
create index vendas_evento_itens_venda_id_idx on public.vendas_evento_itens (venda_id);
