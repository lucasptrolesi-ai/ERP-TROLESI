-- Backfill do código da peça em pedidos já feitos (pedido direto do
-- usuário, 2026-08-06) — codigo_peca nunca foi gravado antes desta coluna
-- existir (migration 20260806000001), então reconstrói matematicamente a
-- partir do que já está salvo: preco_unitario já é por unidade (garantido
-- pela própria coluna gerada `subtotal = quantidade * preco_unitario`), e
-- preco_unitario = codigo_peca × multiplicador — então codigo_peca =
-- preco_unitario ÷ multiplicador. Conferido manualmente contra o pedido
-- #259 antes de aplicar (bateu exato).
--
-- Só reconstrói pra produtos que NÃO usam cotação diária (código não é a
-- base do preço nesses casos — fica null igual antes) e com multiplicador
-- > 0 (evita divisão por zero). Usa o multiplicador ATUAL do produto —
-- se algum produto teve o multiplicador alterado depois da venda, o valor
-- reconstruído fica impreciso pra essa venda específica.
--
-- ROLLBACK:
-- update public.pedido_itens set codigo_peca = null;
-- -- (não distingue o que foi gravado por venda real depois desta
-- -- migration do que foi reconstruído aqui — reverter apaga os dois.
-- -- Rodar só se realmente precisar desfazer tudo.)

update public.pedido_itens pi
set codigo_peca = round(pi.preco_unitario / p.multiplicador, 2)
from public.produtos p
where pi.produto_id = p.id
  and pi.codigo_peca is null
  and coalesce(p.usa_cotacao_diaria, false) = false
  and p.multiplicador > 0;
