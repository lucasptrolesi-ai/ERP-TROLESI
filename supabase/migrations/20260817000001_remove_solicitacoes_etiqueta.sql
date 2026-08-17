-- Reverte a integração de impressão de etiqueta (migration
-- 20260814000001_solicitacoes_etiqueta.sql) — pedido direto do usuário,
-- 2026-08-17: a Argox OS-214TT será substituída por uma impressora de
-- etiqueta mais moderna; a integração inteira foi descontinuada
-- (não só a calibração) pra ser reconstruída do zero quando a nova
-- impressora chegar. O botão "Imprimir etiqueta" na aba Estoque do PDV
-- Eventos voltou a usar só o código de barras em tela (window.print()),
-- sem fila/print-agent.
--
-- ROLLBACK:
-- (não há rollback do rollback — se precisar da fila de volta, reaplique
-- a migration 20260814000001_solicitacoes_etiqueta.sql original)

drop table if exists public.solicitacoes_etiqueta;
