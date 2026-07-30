-- Trava definitiva contra importar compras/notas de clientes específicos
-- (pedido direto do usuário, 2026-07-30) — são compras pessoais, não venda
-- de verdade da loja. O agente local (gmax-agent/agent.py) já filtra a
-- mesma lista antes de mandar pro Supabase, então isso nem deve aparecer na
-- tela de revisão em condições normais — mas essa function é quem grava de
-- verdade, então é ela que precisa da garantia final, mesmo que o agente
-- rodando na loja ainda não tenha sido atualizado.
--
-- ROLLBACK:
-- (reverter pra versão anterior de importar_pedidos_gmax, ver migration
-- 20260724000001_importacao_gmax.sql — o corpo completo está lá)
-- drop function if exists public.cliente_excluido_importacao_gmax(text);

-- Match por "todas as palavras presentes", não substring exata — pega
-- variação de nome com sobrenome no meio (ex: "LUCAS MORAIS PEIXOTO" bate
-- com "LUCAS MORAIS BELTRAO SILVA PEIXOTO TROLESI"). Lista replicada no
-- agente Python; se precisar adicionar/remover alguém, atualizar os dois
-- lugares.
create or replace function public.cliente_excluido_importacao_gmax(p_nome text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_palavras text[] := regexp_split_to_array(
    trim(translate(upper(coalesce(p_nome, '')), 'ÁÀÃÂÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC')),
    '\s+'
  );
  v_bloqueados text[] := array[
    'LUCAS MORAIS PEIXOTO',
    'CRISJANE',
    'KATIA',
    'ROMEU',
    'APARECIDA ALVES DA CUNHA'
  ];
  v_frase text;
begin
  foreach v_frase in array v_bloqueados
  loop
    if string_to_array(v_frase, ' ') <@ v_palavras then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.importar_pedidos_gmax(p_solicitacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relatorio jsonb;
  v_status text;
  v_pedido jsonb;
  v_item jsonb;
  v_parcela jsonb;
  v_cliente jsonb;
  v_cliente_id uuid;
  v_cpf_cnpj text;
  v_pedido_id uuid;
  v_gmax_id integer;
  v_subtotal numeric(10, 2);
  v_produto_id uuid;
  v_quantidade integer;
  v_preco numeric(10, 2);
  v_numero_parcelas integer;
  v_indice integer;
  v_importados integer := 0;
  v_ja_existentes integer := 0;
  v_excluidos integer := 0;
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  select relatorio, status into v_relatorio, v_status
    from public.solicitacoes_importacao_gmax
    where id = p_solicitacao_id
    for update;

  if v_status is null then
    raise exception 'Solicitação não encontrada.';
  end if;
  if v_status <> 'pronto_para_revisao' then
    raise exception 'Essa solicitação já foi processada ou não está pronta para revisão.';
  end if;

  for v_pedido in select * from jsonb_array_elements(v_relatorio -> 'pedidos')
  loop
    v_gmax_id := (v_pedido ->> 'gmax_pedido_id')::integer;

    if exists (select 1 from public.pedidos where gmax_pedido_id = v_gmax_id) then
      v_ja_existentes := v_ja_existentes + 1;
      continue;
    end if;

    v_cliente := v_pedido -> 'cliente';

    if public.cliente_excluido_importacao_gmax(v_cliente ->> 'nome') then
      v_excluidos := v_excluidos + 1;
      continue;
    end if;

    v_cliente_id := nullif(v_cliente ->> 'id', '')::uuid;
    v_cpf_cnpj := nullif(trim(v_cliente ->> 'cpf_cnpj'), '');
    if v_cliente_id is null and v_cpf_cnpj is not null then
      select id into v_cliente_id from public.clientes where cpf_cnpj = v_cpf_cnpj;
    end if;
    if v_cliente_id is null then
      insert into public.clientes (nome, cpf_cnpj, telefone)
      values (v_cliente ->> 'nome', v_cpf_cnpj, v_cliente ->> 'telefone')
      returning id into v_cliente_id;
    end if;

    v_subtotal := 0;
    for v_item in select * from jsonb_array_elements(v_pedido -> 'itens')
    loop
      v_subtotal := v_subtotal + (v_item ->> 'quantidade')::integer * (v_item ->> 'preco_unitario')::numeric;
    end loop;

    v_numero_parcelas := greatest(1, coalesce(jsonb_array_length(v_pedido -> 'parcelas'), 0));

    insert into public.pedidos (
      cliente_id, vendedor_id, status, forma_pagamento,
      subtotal, valor_desconto, valor_acrescimo, total, numero_parcelas, gmax_pedido_id
    )
    values (
      v_cliente_id,
      nullif(v_pedido ->> 'vendedor_id', '')::uuid,
      'faturado',
      (v_pedido ->> 'forma_pagamento')::public.forma_pagamento,
      v_subtotal, 0, 0, v_subtotal, v_numero_parcelas, v_gmax_id
    )
    returning id into v_pedido_id;

    for v_item in select * from jsonb_array_elements(v_pedido -> 'itens')
    loop
      v_produto_id := (v_item ->> 'produto_id')::uuid;
      v_quantidade := (v_item ->> 'quantidade')::integer;
      v_preco := (v_item ->> 'preco_unitario')::numeric;

      insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
      values (v_pedido_id, v_produto_id, v_quantidade, v_preco);

      update public.produtos set quantidade_estoque = quantidade_estoque - v_quantidade
        where id = v_produto_id;

      insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo, pedido_id, criado_por)
      values (v_produto_id, 'saida', v_quantidade, 'Venda (importação GMax #' || v_gmax_id || ')', v_pedido_id, auth.uid());
    end loop;

    if jsonb_array_length(v_pedido -> 'parcelas') > 0 then
      v_indice := 0;
      for v_parcela in select * from jsonb_array_elements(v_pedido -> 'parcelas')
      loop
        v_indice := v_indice + 1;
        insert into public.contas_receber (
          pedido_id, cliente_id, valor, vencimento, forma_pagamento, numero_parcela, total_parcelas
        )
        values (
          v_pedido_id, v_cliente_id,
          (v_parcela ->> 'valor')::numeric,
          (v_parcela ->> 'vencimento')::date,
          (v_pedido ->> 'forma_pagamento')::public.forma_pagamento,
          v_indice, v_numero_parcelas
        );
      end loop;
    end if;

    v_importados := v_importados + 1;
  end loop;

  update public.solicitacoes_importacao_gmax
    set status = 'concluido', concluido_em = now()
    where id = p_solicitacao_id;

  return jsonb_build_object('importados', v_importados, 'ja_existentes', v_ja_existentes, 'excluidos', v_excluidos);
end;
$$;

revoke all on function public.cliente_excluido_importacao_gmax(text) from public;
grant execute on function public.cliente_excluido_importacao_gmax(text) to authenticated;
