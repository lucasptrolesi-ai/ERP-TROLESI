-- Fila de impressão do cupom térmico. A venda pode ser fechada de
-- qualquer aparelho (Mac, Windows, celular) mas só existe UM print-agent
-- local rodando na máquina que tem a impressora térmica fisicamente ligada
-- (ver print-agent/) — um fetch direto do navegador pro loopback dessa
-- máquina (127.0.0.1) só funcionaria se a venda também tivesse sido feita
-- nela, o que não é o caso na maioria das vezes. Em vez disso, o navegador
-- grava aqui o que precisa ser impresso, e o print-agent (rodando na
-- máquina certa) fica checando essa tabela e imprime o que encontrar.
--
-- ROLLBACK:
-- drop table public.solicitacoes_impressao;

create table public.solicitacoes_impressao (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos (id) on delete cascade,
  via text not null check (via in ('loja', 'cliente')),
  linhas jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'impresso', 'erro')),
  erro text,
  criado_em timestamptz not null default now(),
  impresso_em timestamptz
);

-- Só as pendentes importam pro polling do agente — índice parcial fica
-- pequeno pra sempre, mesmo com a tabela crescendo (não tem limpeza
-- automática de linhas antigas; volume de vendas de uma joalheria não
-- justifica isso agora, ver comentário equivalente noutras tabelas de
-- histórico do projeto).
create index solicitacoes_impressao_pendentes_idx
  on public.solicitacoes_impressao (criado_em)
  where status = 'pendente';

alter table public.solicitacoes_impressao enable row level security;

-- Conteúdo é só o texto do cupom (mesma informação que a tela de Pedidos já
-- mostra) — sem necessidade de restringir por papel. Só o print-agent (via
-- service_role, que ignora RLS) marca como impresso/erro; de propósito não
-- existe policy de update pra usuário comum.
create policy "usuarios autenticados criam solicitacao de impressao"
  on public.solicitacoes_impressao for insert
  to authenticated
  with check (true);

create policy "usuarios autenticados leem solicitacoes de impressao"
  on public.solicitacoes_impressao for select
  to authenticated
  using (true);
