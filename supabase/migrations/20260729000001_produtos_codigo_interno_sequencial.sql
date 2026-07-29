-- Código interno passa a ser numerado automaticamente (pedido do usuário,
-- 2026-07-29): hoje o campo era 100% manual e a maioria dos produtos nunca
-- recebeu um valor, o que também travava a busca por código no PDV (o
-- filtro já existia em código, só não tinha dado pra achar nada). Agora
-- todo produto ganha um número sequencial (1, 2, 3, 4...) — os que já
-- existem são numerados na ordem em que foram cadastrados (criado_em), e os
-- próximos ganham o número seguinte sozinhos ao serem criados. Continua
-- editável manualmente (ex: pra bater com um código físico específico do
-- GMax), a numeração automática só entra quando o campo fica em branco.
--
-- ROLLBACK:
-- drop trigger if exists trg_produtos_codigo_interno on public.produtos;
-- drop function if exists public.definir_codigo_interno_produto();
-- drop sequence if exists public.produtos_codigo_interno_seq;
-- -- (não desfaz o backfill dos códigos já preenchidos abaixo — são dados,
-- -- não estrutura; reverter isso exigiria decidir o que fazer com pedidos
-- -- que já foram feitos usando um código gerado por esta migration)

create sequence public.produtos_codigo_interno_seq;

-- Backfill: numera os produtos que ainda não têm código, na ordem de
-- cadastro, continuando a partir do maior código numérico já existente
-- (se algum produto já tiver um código manual tipo "43", o próximo gerado
-- começa depois dele, nunca colide).
do $$
declare
  produto record;
  proximo bigint;
begin
  select coalesce(max(codigo_interno::bigint), 0) + 1
    into proximo
    from public.produtos
   where codigo_interno ~ '^[0-9]+$';

  for produto in
    select id from public.produtos
     where codigo_interno is null
     order by criado_em
  loop
    update public.produtos set codigo_interno = proximo::text where id = produto.id;
    proximo := proximo + 1;
  end loop;

  perform setval('public.produtos_codigo_interno_seq', proximo, false);
end $$;

-- Trigger em vez de "default nextval(...)" na coluna: a tela de cadastro
-- sempre manda a chave codigo_interno no insert (vazia = null explícito), o
-- que já pisaria num default de coluna. Trigger BEFORE INSERT intercepta
-- isso de qualquer jeito, venha null explícito ou o campo só ausente.
create or replace function public.definir_codigo_interno_produto()
returns trigger
language plpgsql
as $$
begin
  if new.codigo_interno is null or btrim(new.codigo_interno) = '' then
    new.codigo_interno := nextval('public.produtos_codigo_interno_seq')::text;
  end if;
  return new;
end;
$$;

create trigger trg_produtos_codigo_interno
  before insert on public.produtos
  for each row
  execute function public.definir_codigo_interno_produto();
