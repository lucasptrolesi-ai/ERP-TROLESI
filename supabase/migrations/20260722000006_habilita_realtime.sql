-- Verificação final de "dado sempre atualizado para todos" (2026-07-22):
-- habilita Supabase Realtime nas tabelas que mudam com mais frequência
-- durante o uso simultâneo em múltiplos aparelhos (a loja já fecha venda em
-- vários terminais ao mesmo tempo, ver print-agent) — produtos (estoque),
-- pedidos/pedido_itens (PDV) e contas_receber/contas_pagar (Financeiro +
-- sininho de vencimentos no layout raiz).
--
-- O app assina essas tabelas em `src/components/realtime-refresh.tsx` e
-- chama router.refresh() quando algo muda — assim um terminal vendendo um
-- produto atualiza o estoque na tela de outro terminal sem precisar de F5.
-- Realtime respeita as políticas de RLS já existentes por papel (não muda
-- quem pode ver o quê, só quando a tela se atualiza sozinha).
--
-- Idempotente (`if not exists`) porque não há garantia de que nenhuma tabela
-- já tenha sido adicionada manualmente pelo dashboard antes desta migration.
--
-- ROLLBACK:
-- alter publication supabase_realtime drop table public.produtos;
-- alter publication supabase_realtime drop table public.pedidos;
-- alter publication supabase_realtime drop table public.pedido_itens;
-- alter publication supabase_realtime drop table public.contas_receber;
-- alter publication supabase_realtime drop table public.contas_pagar;

do $$
declare
  t text;
begin
  foreach t in array array['produtos', 'pedidos', 'pedido_itens', 'contas_receber', 'contas_pagar']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
