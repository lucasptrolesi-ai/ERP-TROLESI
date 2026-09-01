-- Entrada de peça de ouro no PDV Eventos (pedido direto do usuário,
-- 2026-09-01): "digito o código, ele multiplica pela cotação do dia e me dá
-- o preço com 30% de acréscimo" — sem digitar preço manual e sem passar
-- pelo formulário completo (foto, descrição etc.) peça por peça.
--
-- Reaproveita a MESMA cotação diária já usada pelo Estoque real
-- (cotacoes_diarias, migration 20260721000015 — material 'Ouro') em vez de
-- criar uma segunda fonte de cotação: só existe um preço de ouro do dia,
-- vale pros dois módulos. O multiplicador aqui é fixo em 1,30 (30% de
-- acréscimo, valor exato pedido pelo usuário) — diferente do Estoque real,
-- que usa produtos.multiplicador por produto; não faz sentido replicar essa
-- flexibilidade aqui sem um pedido concreto pra isso.
--
-- Peso fica salvo na própria peça (produtos_evento.peso): a primeira vez
-- que um código é usado aqui, pede peso; nas próximas vezes (reposição do
-- mesmo código), o peso salvo é reaproveitado sozinho — só recalcula com a
-- cotação de hoje, sem pedir peso de novo.
--
-- ROLLBACK:
-- revoke execute on function public.entrada_ouro_evento(text, integer, date, text, numeric) from authenticated;
-- drop function if exists public.entrada_ouro_evento(text, integer, date, text, numeric);
-- alter table public.produtos_evento
--   drop column if exists peso,
--   drop column if exists material,
--   drop column if exists usa_cotacao_diaria;

alter table public.produtos_evento
  add column peso numeric(10, 3),
  add column material text,
  add column usa_cotacao_diaria boolean not null default false;

-- p_data é OBRIGATÓRIO de propósito (mesma razão de informar_cotacao,
-- 20260721000015): "hoje" pro negócio é hora de Brasília, current_date do
-- Postgres reflete o fuso do servidor — o cliente sempre manda hojeIso().
--
-- p_peso só é obrigatório pra código NOVO (primeira entrada). Pra código já
-- existente, é ignorado se informado — o peso salvo na peça é sempre a
-- fonte da verdade, pra não divergir entre entradas por engano.
create or replace function public.entrada_ouro_evento(
  p_codigo_interno text,
  p_quantidade integer,
  p_data date,
  p_nome text default null,
  p_peso numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_multiplicador constant numeric := 1.30;
  v_cotacao numeric(10, 2);
  v_id uuid;
  v_peso numeric(10, 3);
  v_preco numeric(10, 2);
begin
  perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade precisa ser maior que zero.';
  end if;

  select valor into v_cotacao
    from public.cotacoes_diarias
    where material = 'Ouro' and data = p_data;

  if v_cotacao is null then
    raise exception 'Cotação do ouro de hoje ainda não foi informada (tela "Cotação").';
  end if;

  select id, peso into v_id, v_peso
    from public.produtos_evento
    where codigo_interno = p_codigo_interno
    for update;

  if v_id is not null then
    if v_peso is null then
      raise exception 'Essa peça já existe mas não tem peso cadastrado — edite a peça e informe o peso antes de usar esta entrada.';
    end if;

    v_preco := round(v_peso * v_cotacao * v_multiplicador, 2);

    update public.produtos_evento
      set preco = v_preco,
          material = 'Ouro',
          usa_cotacao_diaria = true,
          quantidade_estoque = quantidade_estoque + p_quantidade
      where id = v_id;
  else
    if p_peso is null or p_peso <= 0 then
      raise exception 'Informe o peso (g) — código novo, ainda sem peso salvo.';
    end if;
    if p_nome is null or btrim(p_nome) = '' then
      raise exception 'Informe o nome da peça.';
    end if;

    v_preco := round(p_peso * v_cotacao * v_multiplicador, 2);

    insert into public.produtos_evento
      (codigo_interno, nome, peso, material, usa_cotacao_diaria, preco, quantidade_estoque)
    values
      (p_codigo_interno, btrim(p_nome), p_peso, 'Ouro', true, v_preco, p_quantidade)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.entrada_ouro_evento(text, integer, date, text, numeric) from public;
grant execute on function public.entrada_ouro_evento(text, integer, date, text, numeric) to authenticated;
