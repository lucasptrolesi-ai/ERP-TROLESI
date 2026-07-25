-- "Marcar como já contatado" pra cliente inativo (pedido direto do usuário,
-- 2026-07-25): a lista de clientes inativos em /relatorios só mostrava quem
-- precisa de reativação, sem jeito de anotar que alguém já ligou/mandou
-- mensagem — sem isso, o vendedor não tinha como saber se um nome da lista
-- já foi contatado ou não da próxima vez que abrisse a tela.
--
-- Fica de propósito como uma anotação manual simples (decisão do usuário:
-- "só marcar 'já entrei em contato'") — não dispara WhatsApp, não linka pro
-- PDV, não é obrigatório antes de vender. Não é limpo automaticamente
-- quando o cliente volta a comprar (criar_pedido não mexe nesta coluna) —
-- se ficar inativo de novo num ciclo futuro, o marcador antigo ainda
-- aparece até alguém desmarcar/marcar de novo; aceitável pro que foi
-- pedido (só uma anotação, não uma automação).
--
-- ROLLBACK:
-- alter table public.clientes
--   drop column if exists contatado_reativacao_em,
--   drop column if exists contatado_reativacao_por;

alter table public.clientes
  add column contatado_reativacao_em timestamptz,
  add column contatado_reativacao_por uuid references public.profiles (id);
