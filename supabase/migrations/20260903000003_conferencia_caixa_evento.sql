-- Melhorias no fechamento de caixa (pedido do usuário, 2026-09-03, mesmo
-- dia da primeira versão): conferência (contagem física vs saldo
-- calculado), histórico de fechamentos, e mostrar quem fez cada
-- lançamento.
--
-- `criado_por` das 3 tabelas de caixa (20260903000002) nunca era
-- preenchido — os inserts vêm de server actions comuns (supabase.from(...)
-- .insert(...)), não de function SECURITY DEFINER com `auth.uid()`
-- explícito no INSERT (diferente de movimentacoes_estoque_evento). Resolve
-- com um default na própria coluna: `auth.uid()` funciona em DEFAULT igual
-- funciona em `using`/`with check` de RLS, porque o contexto da sessão já
-- carrega o JWT em qualquer um dos dois casos.
--
-- ROLLBACK:
-- alter table public.fechamentos_caixa_evento drop column if exists valor_contado, drop column if exists diferenca;
-- alter table public.movimentos_caixa_evento alter column criado_por drop default;
-- alter table public.aberturas_caixa_evento alter column criado_por drop default;
-- alter table public.fechamentos_caixa_evento alter column criado_por drop default;

alter table public.movimentos_caixa_evento alter column criado_por set default auth.uid();
alter table public.aberturas_caixa_evento alter column criado_por set default auth.uid();
alter table public.fechamentos_caixa_evento alter column criado_por set default auth.uid();

-- Contagem física do dinheiro na gaveta na hora de fechar (opcional — se
-- não contar, fica null e o resumo impresso simplesmente não mostra
-- diferença nenhuma). `diferenca` fica gravada junto (não só calculada na
-- hora de exibir) pra o histórico ficar auto-contido mesmo que a lógica de
-- cálculo do saldo mude no futuro.
alter table public.fechamentos_caixa_evento
  add column valor_contado numeric(10, 2),
  add column diferenca numeric(10, 2);
