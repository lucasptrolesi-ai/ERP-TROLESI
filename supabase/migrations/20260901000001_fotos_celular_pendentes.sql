-- Mailbox pro pareamento "câmera do celular" no cadastro de produto
-- (ver PareamentoCameraCelular): o celular sobe a foto pro Storage e grava
-- aqui qual é a URL; o formulário aberto no Mac fica checando essa tabela a
-- cada ~1.5s pelo session_id do QR que ele mesmo gerou — mesmo raciocínio
-- já usado pra impressão térmica (solicitacoes_impressao, 20260722000003):
-- os dois aparelhos não têm como se falar direto, então um grava e o outro
-- consulta.
--
-- Trocado de Realtime Broadcast pra isso (2026-09-01) depois de troubleshoot
-- ao vivo: broadcast não entrega nada se o lado que escuta não estiver com o
-- canal já "SUBSCRIBED" no instante exato do envio, e diagnosticar essa
-- corrida sem os dois aparelhos em mãos se mostrou inviável. Polling é mais
-- lento (segundos, não milissegundos) mas nunca perde a foto: ela fica
-- salva na linha até o Mac consumir, não numa mensagem efêmera.
--
-- ROLLBACK:
-- drop table public.fotos_celular_pendentes;

create table public.fotos_celular_pendentes (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  prefixo text not null check (prefixo in ('manual', 'evento')),
  foto_url text not null,
  criado_em timestamptz not null default now()
);

create index fotos_celular_pendentes_sessao_idx
  on public.fotos_celular_pendentes (session_id, criado_em);

alter table public.fotos_celular_pendentes enable row level security;

-- Mesmos papéis que já podem subir foto de produto (storage.objects,
-- 20260819000001) — celular e Mac sempre logados com um desses três.
create policy "admin, estoque e vendedor criam foto pendente"
  on public.fotos_celular_pendentes for insert
  to authenticated
  with check (public.meu_papel() in ('admin', 'estoque', 'vendedor'));

create policy "admin, estoque e vendedor leem foto pendente"
  on public.fotos_celular_pendentes for select
  to authenticated
  using (public.meu_papel() in ('admin', 'estoque', 'vendedor'));

-- O Mac apaga a linha assim que consome (poll seguinte não reprocessa) —
-- não tem coluna "consumido", a linha simplesmente some.
create policy "admin, estoque e vendedor apagam foto pendente"
  on public.fotos_celular_pendentes for delete
  to authenticated
  using (public.meu_papel() in ('admin', 'estoque', 'vendedor'));
