-- Fase 4: o campo não é "custo" (valor de aquisição) — é o código/valor
-- base da peça que, multiplicado pelo multiplicador de atacado (2,8),
-- gera o preço de venda direto. Renomeado pra refletir o significado real
-- (usuário corrigiu depois de ver o rótulo "Custo (R$)" no formulário).

alter table public.produtos rename column custo to codigo_peca;
