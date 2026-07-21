-- Achado do code-review (ângulo efficiency): FKs sem índice em colunas
-- consultadas com frequência real (não só hipotética):
--   - pedidos.cliente_id: estatisticas_cliente() roda a cada seleção de
--     cliente no PDV (client-facing, não só relatório admin) e de novo
--     dentro de criar_pedido — sem índice, é sequential scan em pedidos.
--   - crediario_lancamentos.cliente_id / comissoes_lancamentos.vendedor_id:
--     colunas de FK sem índice automático no Postgres, já usadas em RLS
--     (comissoes_lancamentos) e naturais pra consulta por cliente/vendedor.
--
-- ROLLBACK:
-- drop index if exists public.pedidos_cliente_id_idx;
-- drop index if exists public.crediario_lancamentos_cliente_id_idx;
-- drop index if exists public.comissoes_lancamentos_vendedor_id_idx;

create index if not exists pedidos_cliente_id_idx on public.pedidos (cliente_id);
create index if not exists crediario_lancamentos_cliente_id_idx on public.crediario_lancamentos (cliente_id);
create index if not exists comissoes_lancamentos_vendedor_id_idx on public.comissoes_lancamentos (vendedor_id);
