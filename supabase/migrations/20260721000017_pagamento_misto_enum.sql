-- Fase 5: valor novo do enum forma_pagamento pro pagamento misto (seção 16).
-- Isolado numa migration própria, aplicada e commitada sozinha, de
-- propósito: ALTER TYPE ... ADD VALUE não pode ser referenciado/usado na
-- MESMA transação em que foi adicionado (restrição do Postgres) — juntar
-- isso com a function que já usa 'misto' na mesma migration arriscaria
-- "unsafe use of new value of enum type" dependendo de como o script de
-- aplicação agrupa as instruções numa única transação.
--
-- ROLLBACK:
-- Postgres não suporta DROP VALUE em enum — recriar o tipo do zero seria o
-- único jeito de reverter; não fazer isso a menos que estritamente necessário.

alter type public.forma_pagamento add value if not exists 'misto';
