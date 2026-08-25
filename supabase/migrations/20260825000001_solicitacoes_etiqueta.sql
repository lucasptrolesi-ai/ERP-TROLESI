-- Fila de impressão de etiqueta (código de barras + nome + preço) —
-- reconstrução da fila `solicitacoes_etiqueta` (criada em 20260814000001,
-- derrubada em 20260817000001 quando a Argox foi temporariamente
-- descontinuada). Argox reconectada em 2026-08-25, agora no SERVIDOR
-- (Windows, driver Seagull já usado com sucesso pro cupom térmico) — não
-- mais tentativa de comando PPLA/EPL2 cru, que se mostrou não confiável
-- tanto no Mac quanto historicamente no Windows (ver DECISIONS.md).
-- Mesmo padrão de solicitacoes_impressao (cupom): o app grava aqui, o
-- print-agent consome e imprime de verdade.
--
-- Diferença da versão original: adiciona `preco` — a etiqueta agora
-- combina código de barras + nome + preço numa peça só (pedido explícito
-- do usuário, 2026-08-25), não só código de barras como na primeira
-- versão.
--
-- ROLLBACK:
-- drop table if exists public.solicitacoes_etiqueta;

create table public.solicitacoes_etiqueta (
  id uuid primary key default gen_random_uuid(),
  codigo_interno text not null,
  nome text not null,
  preco numeric(10, 2) not null default 0,
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
