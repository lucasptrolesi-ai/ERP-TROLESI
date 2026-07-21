-- Fase 5: resolução das 10 ambiguidades da seção 27 do documento mestre —
-- decisão explícita do usuário em 2026-07-21 de que estas NÃO devem ficar
-- como perguntas em aberto: o documento mestre é pra dar entendimento do
-- negócio, não pra virar uma lista infinita de confirmações. Cada decisão
-- abaixo está documentada com a razão (texto do próprio documento, dado real
-- de migração, ou convenção já estabelecida no projeto) em vez de suposição
-- às cegas. Ver DECISIONS.md pra contexto completo.
--
-- ROLLBACK:
-- update public.pending_decisions set ativo = false, decidido_em = null, decisao = null
--   where chave != 'escopo_documento_mestre_operacao';
-- (as mudanças de function abaixo revertem para os corpos anteriores — ver
-- 20260721000013 pra aprovar_abatimento, 20260721000005 pra crediário)

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Peças de prata 925 código≥20 contam normalmente dentro do mesmo total usado pro mínimo de primeira compra — não criamos um mínimo separado, o documento não define um valor pra isso. O carrinho passa a expor esse subtotal separadamente na tela de venda sempre que houver esse tipo de peça, dando visibilidade sem inventar uma regra de corte adicional. Decidido autonomamente sob autorização do usuário em 2026-07-21.'
where chave = 'primeira_compra_prata925_combinacao';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Base = total final do pedido (pedidos.total, já com desconto automático aplicado) — o valor que o cliente efetivamente paga. Não recalcula uma base "só itens elegíveis" separada pra não duplicar a lógica de desconto; a diferença prática de deixar fornitura fora dessa conta específica é marginal. Decidido/implementado em 2026-07-21.'
where chave = 'frete_gratis_base_calculo';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Pagamento misto não recebe desconto automático — o próprio documento veta inventar uma divisão proporcional sem regra definida; a saída segura é simplesmente não aplicar desconto automático quando a forma é "misto" (mesmo tratamento que cartão de crédito/promissória já têm hoje). Decidido/implementado em 2026-07-21.'
where chave = 'desconto_pagamento_misto';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Investigado nos 44 produtos migrados do GMax (CSV real, PRODUTO_EMPRESA.csv): nenhuma evidência de uso da cifra V=1/E=2/N=3/T=4/I=5/L=6/A=7/D=8/O=9/R=0 nos códigos internos reais — CODIGO_INTERNO é SKU sequencial comum (ex: "010023"), não a cifra. Feature permanece NÃO implementada até alguma evidência real de uso aparecer — não presumida por especulação, conforme exigido pela seção 7. Confirmado em 2026-07-21.'
where chave = 'codigo_ventilador_finalidade';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Comissão do crediário legado é gerada no evento de RECEBIMENTO (não no lançamento da dívida), usando o vendedor do pedido de origem do lançamento (crediario_lancamentos.pedido_id → pedidos.vendedor_id) quando existir e tiver evento_gerador=''recebimento'' configurado. Lançamentos sem pedido de origem (saldo legado migrado sem venda correspondente no sistema novo) não geram comissão automática — não há vendedor identificável pra atribuir; lançamento manual continua disponível. Decidido/implementado em 2026-07-21.'
where chave = 'comissao_crediario_calculo';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Bloqueio ocorre quando o atraso é MAIOR que 5 dias (a partir do 6º dia) — lendo literalmente o texto do documento ("atraso > 5 dias"). Implementado como checagem dinâmica (mesmo padrão de situacaoEfetiva já usado no projeto pra contas_receber/contas_pagar) em vez de uma flag manual que ficaria desatualizada. Decidido/implementado em 2026-07-21.'
where chave = 'crediario_bloqueio_atraso';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Medição é uma estimativa visual registrada pelo atendente no formulário de garantia (percentual_descascamento, 0-100%, sem instrumento de medição formal) — é como o sistema já funciona desde a Fase 4; esta decisão só formaliza que essa é a interpretação final, não um placeholder temporário. Decidido em 2026-07-21.'
where chave = 'garantia_descascamento_medicao';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Peça aprovada é destinada ao local de estoque "Abatimentos recebidos" (já cadastrado em locais_estoque desde a Fase 2) — fica registrada ali como rastreio físico de onde a peça está guardada, sem virar item revendável do catálogo de produtos automaticamente. Reaproveitamento/refino da peça fica como decisão comercial manual futura, fora de escopo. Decidido/implementado em 2026-07-21.'
where chave = 'abatimento_destino_pecas';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Sim — ouro e cobre usam a cotação do dia como preço-base do grama, e o multiplicador comercial se aplica em cima dela (cotação define o custo/base, multiplicador aplica a margem — sem isso a venda seria a preço de custo). Implementada tabela de cotações diárias por material + tela mínima de lançamento (permissão "informar_cotacao", já existente desde a Fase 1 e até agora sem uso real). Decidido/implementado em 2026-07-21.'
where chave = 'multiplicador_ouro_cobre';

update public.pending_decisions set
  ativo = true,
  decidido_em = now(),
  decisao = 'Não reduz — abatimento e desconto/frete são lançamentos separados por definição do próprio documento ("abatimento e desconto comercial são lançamentos contábeis diferentes"). O valor abatido não desconta da base usada pro desconto automático nem pro frete grátis; é aplicado como crédito à parte sobre o total da venda. Não exigiu mudança de código — o sistema já trata os dois fluxos separadamente desde a Fase 4. Decidido em 2026-07-21.'
where chave = 'abatimento_reduz_base_desconto_frete';

-- ===== Abatimento: destino físico da peça aprovada (decisão #8) =====
create or replace function public.aprovar_abatimento(
  p_id uuid,
  p_valor_final numeric default null,
  p_justificativa text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.abatimento_status;
  v_local_id uuid;
begin
  if not public.tem_permissao('aprovar_valor_abatimento') then
    raise exception 'Sem permissão para aprovar abatimento.';
  end if;

  select status into v_status from public.abatimentos where id = p_id for update;
  if v_status is null then
    raise exception 'Abatimento não encontrado.';
  end if;
  if v_status <> 'avaliando' then
    raise exception 'Só é possível aprovar um abatimento que ainda está em avaliação.';
  end if;

  select id into v_local_id from public.locais_estoque where nome = 'Abatimentos recebidos';

  update public.abatimentos
    set status = 'aprovado',
        autorizado_por = auth.uid(),
        valor_atribuido = coalesce(p_valor_final, valor_atribuido),
        local_id = coalesce(local_id, v_local_id),
        atualizado_em = now()
    where id = p_id;

  perform public.registrar_auditoria('abatimentos', p_id, 'aprovar', null, jsonb_build_object('valor_atribuido', coalesce(p_valor_final, 0)), p_justificativa);
end;
$$;
-- Grants já existentes (mesma assinatura) continuam valendo.

-- ===== Crediário: bloqueio automático > 5 dias de atraso (decisão #6) =====
create or replace function public.lancar_crediario(
  p_cliente_id uuid,
  p_pedido_id uuid,
  p_valor numeric,
  p_vencimento date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crediario_legado boolean;
  v_id uuid;
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  select crediario_legado into v_crediario_legado from public.clientes where id = p_cliente_id;
  if v_crediario_legado is not true then
    raise exception 'Cliente não está autorizado pra crediário legado.';
  end if;
  if p_valor <= 0 then
    raise exception 'Valor precisa ser maior que zero.';
  end if;

  if exists (
    select 1 from public.crediario_lancamentos
    where cliente_id = p_cliente_id
      and situacao != 'pago'
      and (current_date - vencimento) > 5
  ) then
    raise exception 'Cliente com crediário em atraso há mais de 5 dias — lançamento bloqueado até regularização.';
  end if;

  insert into public.crediario_lancamentos (cliente_id, pedido_id, valor, vencimento)
  values (p_cliente_id, p_pedido_id, p_valor, p_vencimento)
  returning id into v_id;

  return v_id;
end;
$$;
-- Grants já existentes (mesma assinatura) continuam valendo.

-- ===== Crediário: comissão automática no recebimento (decisão #5) =====
create or replace function public.receber_crediario(p_id uuid, p_recibo_numero text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linhas integer;
  v_lancamento record;
  v_vendedor record;
  v_valor_comissao numeric(10, 2);
begin
  if not public.tem_permissao('receber_crediario') then
    raise exception 'Sem permissão para receber crediário.';
  end if;

  select id, cliente_id, pedido_id, valor into v_lancamento
    from public.crediario_lancamentos where id = p_id and situacao != 'pago' for update;
  if v_lancamento.id is null then
    raise exception 'Lançamento não encontrado ou já pago.';
  end if;

  update public.crediario_lancamentos
    set situacao = 'pago', pago_em = now(), recebido_por = auth.uid(), recibo_numero = p_recibo_numero
    where id = p_id;

  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception 'Lançamento não encontrado ou já pago.';
  end if;

  perform public.registrar_auditoria('crediario_lancamentos', p_id, 'receber', null, jsonb_build_object('recibo', p_recibo_numero), null);

  -- Comissão automática (decisão #5): só quando o lançamento tem um pedido
  -- de origem identificável e o vendedor desse pedido tem comissão
  -- configurada pra disparar no recebimento (não na venda).
  if v_lancamento.pedido_id is not null then
    select v.id, v.comissao_percentual, v.comissao_fixa
      into v_vendedor
      from public.vendedores v
      join public.pedidos p on p.vendedor_id = v.profile_id
      where p.id = v_lancamento.pedido_id and v.evento_gerador = 'recebimento' and v.ativo;

    if v_vendedor.id is not null then
      v_valor_comissao := round(coalesce(v_lancamento.valor * coalesce(v_vendedor.comissao_percentual, 0) / 100, 0), 2)
        + coalesce(v_vendedor.comissao_fixa, 0);

      if v_valor_comissao > 0 then
        insert into public.comissoes_lancamentos (vendedor_id, pedido_id, evento, valor_base, valor_comissao)
        values (v_vendedor.id, v_lancamento.pedido_id, 'recebimento', v_lancamento.valor, v_valor_comissao);
      end if;
    end if;
  end if;
end;
$$;
-- Grants já existentes (mesma assinatura) continuam valendo.
