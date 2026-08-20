-- Nome/CPF/telefone do cliente na venda de evento (pedido do usuário,
-- 2026-08-20) — opcionais, não bloqueiam a venda. PDV Eventos é anônimo por
-- desenho (sem tabela clientes vinculada), então isso fica direto na própria
-- venda, texto livre, sem índice único nem validação de formato — é só pra
-- imprimir na notinha junto dos dados da empresa, não é um cadastro de
-- verdade.
--
-- ROLLBACK:
-- drop function if exists public.criar_venda_evento(jsonb, text, numeric, integer, uuid, text, text, text);
-- alter table public.vendas_evento drop column if exists cliente_nome;
-- alter table public.vendas_evento drop column if exists cliente_cpf;
-- alter table public.vendas_evento drop column if exists cliente_telefone;
-- Depois, recriar a função com a assinatura de 5 parâmetros (ver
-- 20260813000001_pdv_eventos.sql pela definição original completa).

alter table public.vendas_evento
  add column if not exists cliente_nome text,
  add column if not exists cliente_cpf text,
  add column if not exists cliente_telefone text;

-- Assinatura muda (3 parâmetros novos) — create or replace NÃO substitui
-- uma função quando a lista de parâmetros é diferente, cria um segundo
-- overload em paralelo (exatamente o bug de 2026-08-06 documentado no
-- DECISIONS.md, com criar_pedido). Precisa dropar a assinatura antiga
-- explicitamente antes de recriar.
drop function if exists public.criar_venda_evento(jsonb, text, numeric, integer, uuid);

create or replace function public.criar_venda_evento(
  p_itens jsonb, -- [{produto_evento_id, quantidade, preco_unitario, nome}]
  p_forma_pagamento text,
  p_valor_desconto numeric default 0,
  p_numero_parcelas integer default 1,
  p_idempotency_key uuid default null,
  p_cliente_nome text default null,
  p_cliente_cpf text default null,
  p_cliente_telefone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda_id uuid;
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade integer;
  v_preco numeric(10, 2);
  v_estoque_atual integer;
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_idempotency_key is not null then
    select id into v_venda_id from public.vendas_evento where idempotency_key = p_idempotency_key;
    if v_venda_id is not null then
      return v_venda_id;
    end if;
  end if;

  if p_forma_pagamento not in ('dinheiro', 'pix', 'cartao_vista', 'cartao_parcelado') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'A venda precisa de pelo menos um item.';
  end if;

  if coalesce(p_valor_desconto, 0) < 0 then
    raise exception 'Desconto não pode ser negativo.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_preco := (v_item ->> 'preco_unitario')::numeric;
    if v_preco < 0 then
      raise exception 'Preço unitário não pode ser negativo.';
    end if;
    if (v_item ->> 'quantidade')::integer <= 0 then
      raise exception 'Quantidade precisa ser maior que zero.';
    end if;
    v_subtotal := v_subtotal + (v_item ->> 'quantidade')::integer * v_preco;
  end loop;

  v_total := v_subtotal - coalesce(p_valor_desconto, 0);
  if v_total < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  begin
    insert into public.vendas_evento (
      forma_pagamento, numero_parcelas, subtotal, valor_desconto, total, idempotency_key, criado_por,
      cliente_nome, cliente_cpf, cliente_telefone
    )
    values (
      p_forma_pagamento, greatest(1, p_numero_parcelas), v_subtotal, coalesce(p_valor_desconto, 0), v_total,
      p_idempotency_key, auth.uid(),
      nullif(btrim(p_cliente_nome), ''), nullif(btrim(p_cliente_cpf), ''), nullif(btrim(p_cliente_telefone), '')
    )
    returning id into v_venda_id;
  exception
    when unique_violation then
      select id into v_venda_id from public.vendas_evento where idempotency_key = p_idempotency_key;
      return v_venda_id;
  end;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_produto_id := (v_item ->> 'produto_evento_id')::uuid;
    v_quantidade := (v_item ->> 'quantidade')::integer;
    v_preco := (v_item ->> 'preco_unitario')::numeric;

    select quantidade_estoque into v_estoque_atual from public.produtos_evento where id = v_produto_id for update;
    if v_estoque_atual is null then
      raise exception 'Produto do evento não encontrado.';
    end if;
    update public.produtos_evento set quantidade_estoque = quantidade_estoque - v_quantidade
      where id = v_produto_id;

    insert into public.vendas_evento_itens (venda_id, produto_evento_id, nome, quantidade, preco_unitario)
    values (v_venda_id, v_produto_id, coalesce(v_item ->> 'nome', ''), v_quantidade, v_preco);
  end loop;

  return v_venda_id;
end;
$$;

revoke all on function public.criar_venda_evento(
  jsonb, text, numeric, integer, uuid, text, text, text
) from public;
grant execute on function public.criar_venda_evento(
  jsonb, text, numeric, integer, uuid, text, text, text
) to authenticated;
