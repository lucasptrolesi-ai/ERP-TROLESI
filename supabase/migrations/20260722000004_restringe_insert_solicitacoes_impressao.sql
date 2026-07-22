-- Achado real do code-review: a policy de insert de solicitacoes_impressao
-- (20260722000003) liberava `with check (true)` pra qualquer papel
-- autenticado, incluindo 'estoque' — que não deveria criar solicitação de
-- impressão nenhuma (não mexe com vendas). Não é vazamento de dado (select
-- já é aberto pro time todo, igual pedidos — ver comentário da migration
-- anterior), mas dava pra qualquer papel spammar a fila e desperdiçar papel
-- na única impressora física. Restringe insert aos papéis que realmente
-- lidam com venda/cupom.
--
-- ROLLBACK:
-- drop policy "usuarios autenticados criam solicitacao de impressao" on public.solicitacoes_impressao;
-- create policy "usuarios autenticados criam solicitacao de impressao"
--   on public.solicitacoes_impressao for insert
--   to authenticated
--   with check (true);

drop policy "usuarios autenticados criam solicitacao de impressao" on public.solicitacoes_impressao;

create policy "admin, vendedor e financeiro criam solicitacao de impressao"
  on public.solicitacoes_impressao for insert
  to authenticated
  with check (public.meu_papel() in ('admin', 'vendedor', 'financeiro'));
