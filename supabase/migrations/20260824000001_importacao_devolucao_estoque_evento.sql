-- Integração Estoque real <-> PDV Eventos (pedido direto do usuário,
-- 2026-08-24): botão "Importar do Estoque" no PDV Eventos e botão
-- "Devolução" no Estoque real, ligados pela nova coluna
-- produtos_evento.produto_origem_id. Nunca exclui nada em nenhuma ponta —
-- importação/devolução só ajustam quantidade_estoque; movimentacoes_estoque_evento
-- fica como histórico de auditoria (snapshot de nome, pra sobreviver a uma
-- eventual exclusão futura de qualquer um dos dois lados).
--
-- ROLLBACK:
-- revoke execute on function public.devolver_produto_evento(uuid, integer) from authenticated;
-- drop function if exists public.devolver_produto_evento(uuid, integer);
-- revoke execute on function public.importar_produto_evento(uuid, integer, numeric) from authenticated;
-- drop function if exists public.importar_produto_evento(uuid, integer, numeric);
-- drop table if exists public.movimentacoes_estoque_evento;
-- drop type if exists public.tipo_movimentacao_estoque_evento;
-- drop index if exists public.produtos_evento_produto_origem_id_key;
-- alter table public.produtos_evento drop column if exists produto_origem_id;

alter table public.produtos_evento
  add column produto_origem_id uuid references public.produtos (id) on delete set null;

-- Único por produto real: uma importação de uma peça já vinculada soma na
-- mesma linha do evento em vez de criar uma peça duplicada.
create unique index produtos_evento_produto_origem_id_key
  on public.produtos_evento (produto_origem_id)
  where produto_origem_id is not null;

create type public.tipo_movimentacao_estoque_evento as enum ('importacao', 'devolucao');

create table public.movimentacoes_estoque_evento (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_movimentacao_estoque_evento not null,
  -- set null (não restrict) nos dois lados, mesmo espírito de
  -- vendas_evento_itens.produto_evento_id (migration 20260813000001):
  -- excluir a peça real ou a peça do evento no futuro nunca pode travar,
  -- só desvincula o histórico — por isso produto_nome é sempre gravado
  -- (snapshot), não depende da FK continuar viva pra fazer sentido.
  produto_id uuid references public.produtos (id) on delete set null,
  produto_evento_id uuid references public.produtos_evento (id) on delete set null,
  produto_nome text not null,
  quantidade integer not null check (quantidade > 0),
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now()
);

create index movimentacoes_estoque_evento_produto_id_idx on public.movimentacoes_estoque_evento (produto_id);
create index movimentacoes_estoque_evento_produto_evento_id_idx on public.movimentacoes_estoque_evento (produto_evento_id);

alter table public.movimentacoes_estoque_evento enable row level security;

create policy "time logado le movimentacoes_estoque_evento"
  on public.movimentacoes_estoque_evento for select
  using (auth.uid() is not null);

-- Sem policy de insert direta, mesmo padrão de vendas_evento/vendas_evento_itens
-- (migration 20260813000001): só grava através das functions abaixo
-- (SECURITY DEFINER), garantindo que quantidade_estoque dos dois lados e o
-- registro de auditoria sempre andam juntos, nunca um insert avulso
-- dessincronizado.

-- Importa p_quantidade unidades do produto real p_produto_id pro estoque do
-- evento. Se já existe uma peça do evento vinculada a esse produto real
-- (produto_origem_id), soma na quantidade dela em vez de duplicar linha.
-- p_preco é o preço sugerido pro evento (editável na hora de importar);
-- null usa o preço atual do produto real.
create or replace function public.importar_produto_evento(
  p_produto_id uuid,
  p_quantidade integer,
  p_preco numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estoque_real integer;
  v_nome text;
  v_foto_url text;
  v_preco_real numeric(10, 2);
  v_produto_evento_id uuid;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade precisa ser maior que zero.';
  end if;

  select quantidade_estoque, nome, foto_url, preco
    into v_estoque_real, v_nome, v_foto_url, v_preco_real
    from public.produtos
    where id = p_produto_id
    for update;

  if v_nome is null then
    raise exception 'Produto não encontrado no estoque real.';
  end if;

  if p_quantidade > v_estoque_real then
    raise exception 'Estoque real insuficiente: só há % un. disponível(is).', v_estoque_real;
  end if;

  update public.produtos set quantidade_estoque = quantidade_estoque - p_quantidade
    where id = p_produto_id;

  select id into v_produto_evento_id
    from public.produtos_evento
    where produto_origem_id = p_produto_id
    for update;

  if v_produto_evento_id is not null then
    update public.produtos_evento
      set quantidade_estoque = quantidade_estoque + p_quantidade
      where id = v_produto_evento_id;
  else
    insert into public.produtos_evento (nome, preco, quantidade_estoque, foto_url, produto_origem_id)
    values (v_nome, coalesce(p_preco, v_preco_real), p_quantidade, v_foto_url, p_produto_id)
    returning id into v_produto_evento_id;
  end if;

  insert into public.movimentacoes_estoque_evento (tipo, produto_id, produto_evento_id, produto_nome, quantidade, criado_por)
  values ('importacao', p_produto_id, v_produto_evento_id, v_nome, p_quantidade, auth.uid());

  return v_produto_evento_id;
end;
$$;

revoke all on function public.importar_produto_evento(uuid, integer, numeric) from public;
grant execute on function public.importar_produto_evento(uuid, integer, numeric) to authenticated;

-- Devolve p_quantidade unidades da peça do evento p_produto_evento_id pro
-- estoque real (produto_origem_id). Só funciona em peças que vieram de uma
-- importação (produto_origem_id preenchido) — peças cadastradas manualmente
-- no evento, sem vínculo, não têm pra onde devolver. Nunca exclui a peça do
-- evento, mesmo zerando a quantidade.
create or replace function public.devolver_produto_evento(
  p_produto_evento_id uuid,
  p_quantidade integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estoque_evento integer;
  v_produto_origem_id uuid;
  v_nome text;
begin
  perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade precisa ser maior que zero.';
  end if;

  select quantidade_estoque, produto_origem_id, nome
    into v_estoque_evento, v_produto_origem_id, v_nome
    from public.produtos_evento
    where id = p_produto_evento_id
    for update;

  if v_nome is null then
    raise exception 'Peça do evento não encontrada.';
  end if;

  if v_produto_origem_id is null then
    raise exception 'Essa peça do evento não tem vínculo com o estoque real — não é possível devolver.';
  end if;

  if p_quantidade > v_estoque_evento then
    raise exception 'Quantidade maior do que o disponível no evento (%).', v_estoque_evento;
  end if;

  update public.produtos_evento set quantidade_estoque = quantidade_estoque - p_quantidade
    where id = p_produto_evento_id;

  update public.produtos set quantidade_estoque = quantidade_estoque + p_quantidade
    where id = v_produto_origem_id;

  insert into public.movimentacoes_estoque_evento (tipo, produto_id, produto_evento_id, produto_nome, quantidade, criado_por)
  values ('devolucao', v_produto_origem_id, p_produto_evento_id, v_nome, p_quantidade, auth.uid());

  return v_estoque_evento - p_quantidade;
end;
$$;

revoke all on function public.devolver_produto_evento(uuid, integer) from public;
grant execute on function public.devolver_produto_evento(uuid, integer) to authenticated;
