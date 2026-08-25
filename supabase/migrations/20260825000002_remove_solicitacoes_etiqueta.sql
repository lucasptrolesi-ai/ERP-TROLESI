-- Remove a fila de etiqueta (código de barras + nome + preço) reconstruída
-- em 20260825000001 — usuário decidiu abandonar a impressão via Argox
-- depois de horas de tentativa sem sucesso confiável (nem no Mac via USB
-- direto, nem via driver Windows no SERVIDOR: dimensão real da etiqueta
-- nunca confirmada com certeza — testes com 44mm, 43mm, 41.63mm e 95mm
-- todos deram resultados inconsistentes). Reverte código correspondente
-- (commits que reconstruíram isso em 25/08) e agora o schema também.
--
-- ROLLBACK:
-- (reaplicar 20260825000001_solicitacoes_etiqueta.sql pra recriar)

drop table if exists public.solicitacoes_etiqueta;
