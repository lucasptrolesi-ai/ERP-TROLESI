-- Fila de impressão de etiqueta de código de barras (pedido direto do
-- usuário, 2026-08-14) — mesmo padrão de solicitacoes_impressao (cupom
-- térmico), só que pra etiqueta pequena (21mm x 7mm) na impressora Argox
-- OS-214TT, ligada na máquina "SERVIDOR" (a mesma que já roda o
-- print-agent do cupom). O app grava o pedido aqui; o print-agent
-- (rodando nessa máquina, com o driver Windows já calibrado) consome a
-- fila e imprime de verdade. Ver print-agent/README.md.
--
-- ROLLBACK:
-- drop table if exists public.solicitacoes_etiqueta;

create table public.solicitacoes_etiqueta (
  id uuid primary key default gen_random_uuid(),
  codigo_interno text not null,
  nome text not null,
  status text not null default 'pendente' check (status in ('pendente', 'impresso', 'erro')),
  erro text,
  criado_em timestamptz not null default now(),
  impresso_em timestamptz
);

-- Mesmo índice parcial de solicitacoes_impressao — o print-agent roda essa
-- mesma consulta (status='pendente') a cada ~2s pra sempre; sem o índice,
-- vira full table scan conforme a fila acumula meses de venda de evento.
create index solicitacoes_etiqueta_pendentes_idx
  on public.solicitacoes_etiqueta (criado_em)
  where (status = 'pendente');

alter table public.solicitacoes_etiqueta enable row level security;

-- Mesmos papéis que já têm acesso à aba Estoque do PDV Eventos
-- (podeEditarPedidos, ver /pdv-eventos/page.tsx) — só quem chega no botão
-- "Imprimir etiqueta" consegue gravar um pedido de impressão.
create policy "admin e vendedor criam solicitacao de etiqueta"
  on public.solicitacoes_etiqueta for insert
  with check (public.meu_papel() in ('admin', 'vendedor'));

create policy "usuarios autenticados leem solicitacoes de etiqueta"
  on public.solicitacoes_etiqueta for select
  using (auth.uid() is not null);

-- Sem policy de update/delete pro app de propósito — só o print-agent
-- (service_role, bypassa RLS) marca como impresso/erro, mesmo espírito de
-- solicitacoes_impressao.
