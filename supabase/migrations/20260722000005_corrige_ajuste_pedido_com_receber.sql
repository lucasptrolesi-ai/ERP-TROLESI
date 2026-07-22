-- Verificação final de "dado sempre atualizado" (2026-07-22): achado real
-- ao auditar todas as Server Actions em busca de dado que fica desalinhado
-- entre telas/pessoas.
--
-- ajustar_valor_pedido só bloqueava edição quando numero_parcelas > 1, mas
-- uma venda no cartão de crédito (ou promissória) EM 1x já gera
-- numero_parcelas = 1 e uma linha real em contas_receber (ver criar_pedido:
-- a linha é criada sempre que p_parcelas tem pelo menos 1 elemento, não só
-- quando tem mais de uma). Isso deixava "Salvar ajuste" liberado na tela do
-- pedido pra esse caso — o vendedor mudava o desconto/acréscimo, o total do
-- pedido era atualizado, mas a parcela em contas_receber (o que o
-- Financeiro de fato cobra) continuava com o valor antigo: dois lugares
-- mostrando dois valores diferentes pro mesmo pedido, sem nenhum aviso.
-- Pagamento misto (`pedido_pagamentos_mistos`) tem o mesmo problema: nunca
-- gera contas_receber, então a checagem original o deixaria passar batido.
--
-- Revisão independente (subagent) achou um furo real na primeira versão
-- desta migration antes dela ser aplicada: a checagem original fazia um
-- `select exists(...) from contas_receber` dentro de uma function
-- `security invoker` — mas a RLS de contas_receber só libera SELECT pra
-- admin/financeiro (`20260713000005_financeiro.sql`), e quem efetivamente
-- clica em "Salvar ajuste" no dia a dia é o vendedor (permitido por
-- `podeEditarPedidos`). Pra esse papel a subquery sempre via zero linhas,
-- então a trava nunca disparava — corrigido isolando a checagem numa
-- function auxiliar `security definer` (mesmo padrão de `meu_papel()`),
-- que bypassa RLS de propósito só pra essa leitura booleana.
--
-- Fix final: a trava é "existe QUALQUER registro financeiro gerado pra esse
-- pedido" — contas_receber (cartão/promissória, 1x ou mais) OU
-- pedido_pagamentos_mistos (pagamento misto). Dinheiro/Pix puros continuam
-- sempre ajustáveis (não geram nenhum dos dois).
--
-- ROLLBACK:
-- drop function if exists public.pedido_tem_registro_financeiro(uuid);
-- (e recriar ajustar_valor_pedido com o corpo de
-- 20260721000004_correcoes_review_fase4.sql — mesma assinatura)

create or replace function public.pedido_tem_registro_financeiro(p_pedido_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from public.contas_receber where pedido_id = p_pedido_id)
      or exists(select 1 from public.pedido_pagamentos_mistos where pedido_id = p_pedido_id);
$$;

revoke all on function public.pedido_tem_registro_financeiro(uuid) from public;
grant execute on function public.pedido_tem_registro_financeiro(uuid) to authenticated;

create or replace function public.ajustar_valor_pedido(
  p_pedido_id uuid,
  p_valor_desconto numeric,
  p_valor_acrescimo numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subtotal numeric(10, 2);
  v_status public.status_pedido;
begin
  if coalesce(p_valor_desconto, 0) < 0 or coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Desconto e acréscimo não podem ser negativos.';
  end if;

  select subtotal, status into v_subtotal, v_status
    from public.pedidos where id = p_pedido_id for update;
  if v_subtotal is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Não é possível ajustar um pedido cancelado.';
  end if;
  if v_status = 'lancado_gmax' then
    raise exception 'Este pedido já foi lançado no GMax — não pode ser ajustado por aqui.';
  end if;

  if public.pedido_tem_registro_financeiro(p_pedido_id) then
    raise exception 'Este pedido já tem parcela(s) financeira(s) geradas (cartão, promissória ou pagamento misto) — extorne e crie um novo pedido pra mudar o valor, em vez de editar, pra não desalinhar o valor já registrado.';
  end if;

  if v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0) < 0 then
    raise exception 'Valor a pagar não pode ficar negativo.';
  end if;

  update public.pedidos
    set
      valor_desconto = coalesce(p_valor_desconto, 0),
      percentual_desconto = null,
      valor_acrescimo = coalesce(p_valor_acrescimo, 0),
      percentual_acrescimo = null,
      total = v_subtotal - coalesce(p_valor_desconto, 0) + coalesce(p_valor_acrescimo, 0),
      atualizado_em = now()
    where id = p_pedido_id;
end;
$$;
