-- Cashback no PDV Varejo (pedido do usuario, 2026-10-19/21, Fase 3 de 3 -- cliente, cupom, cashback):
-- conceder um credito (valor ou percentual da venda, com vencimento) pro cliente usar numa compra
-- futura, e o sistema aponta esse credito automaticamente quando o mesmo cliente e selecionado de
-- novo no PDV -- nunca aplica sozinho, so avisa (o vendedor decide se usa).
--
-- Oposto do crediario (dinheiro que o CLIENTE deve pra loja): aqui e a loja que deve ao cliente.
-- Mesmo padrao de tabela/estados do crediario (cliente_id, valor, vencimento, situacao), mas sem
-- reaproveitar `crediario_lancamentos` -- aquela tabela e do Atacado (pedido_id, RLS so-admin,
-- `tem_permissao()`); esta e nova, propria do Varejo (venda_origem_id, RLS admin+vendedor,
-- `assert_papel()`, mesmo padrao de cupons_varejo).
--
-- NAO MUDA registrar_venda: conceder_cashback/resgatar_cashback sao functions NOVAS que so chamam
-- registrar_venda por baixo (nao mexem no corpo dela) -- zero risco de regressao na venda em si.
-- Resgate: o valor do cashback usado entra no MESMO p_valor_desconto que o carrinho ja manda pro
-- registrar_venda (que ja aceita qualquer valor >= 0 livremente, sem PIN, desde 20260930000001) -- o
-- app resolve o valor em R$ e desconta no carrinho ANTES de finalizar a venda.
--
-- Atomicidade (revisado apos code-review, 2026-10-21): a primeira versao chamava registrar_venda e
-- resgatar_cashback/conceder_cashback como DUAS chamadas RPC separadas, encadeadas (mesmo padrao de
-- registrar_compra_atacado_varejo). Achado real: se a venda tivesse sucesso mas a segunda chamada
-- falhasse (ex: outra venda consumiu o mesmo cashback um instante antes), a venda ja saia com o
-- desconto embutido e o cashback continuava 'disponivel' -- cliente ficava com o desconto E o credito
-- intactos pra usar de novo. Por isso existe `registrar_venda_varejo_com_cashback`: uma unica function
-- que faz as tres chamadas dentro de UMA SO transacao -- qualquer falha desfaz tudo, inclusive a
-- venda. O app agora chama sempre essa function (os parametros de cashback vem null quando a venda
-- nao usa cashback nenhum -- comportamento identico a chamar registrar_venda direto).
--
-- resgatar_cashback continua grantada pra "authenticated" direto (nao so chamada por dentro do
-- wrapper) -- ela mesma confere, lendo vendas.desconto_manual ja persistido, que a venda passada tem
-- desconto suficiente pra cobrir o cashback (achado de code-review, 2026-10-21: uma chamada direta,
-- fora do wrapper, podia marcar o cashback como usado numa venda sem desconto nenhum).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo. Apaga a tabela cashback_lancamentos inteira, a trigger de validacao e as 3 functions
-- -- (conceder_cashback, resgatar_cashback, registrar_venda_varejo_com_cashback) -- cashback concedido
-- -- ate aqui seria perdido.
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque so esta linha): 'ensaio' | 'aplicar' | 'desfazer'
select set_config('app.modo_migration', 'ensaio', true);
set local lock_timeout = '15s';

do $modo$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar', 'desfazer') then
    raise exception 'Modo invalido em app.modo_migration (use ensaio, aplicar ou desfazer).';
  end if;
  raise notice 'Modo: %', current_setting('app.modo_migration', true);
end $modo$;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  create table public.cashback_lancamentos (
    id uuid primary key default gen_random_uuid(),
    -- `clientes` e global (sem operacao_id, usado pelo Atacado e Varejo) -- mas cashback e um
    -- mecanismo PROPRIO do Varejo, e um vendedor pode estar vinculado a mais de uma operacao
    -- (confirmado: a vendedora real usada nos testes esta ligada a ATACADO e VAREJO ao mesmo tempo).
    -- Sem esta coluna, a RLS abaixo (que so olha o papel, igual cupons_varejo) deixaria QUALQUER
    -- admin/vendedor -- inclusive de uma operacao diferente -- ler/escrever cashback do Varejo direto
    -- pela tabela (achado no code-review, 2026-10-21). `cupons_varejo` (Fase 2, ja aplicada) tem a
    -- MESMA lacuna -- fica registrado em DECISIONS.md como pendencia de migration separada.
    operacao_id uuid not null references public.operacoes (id),
    cliente_id uuid not null references public.clientes (id),
    venda_origem_id uuid not null references public.vendas (id),
    valor numeric(10, 2) not null check (valor > 0),
    vencimento date not null,
    situacao text not null default 'disponivel' check (situacao in ('disponivel', 'usado', 'cancelado')),
    usado_na_venda_id uuid references public.vendas (id),
    usado_em timestamptz,
    criado_por uuid references public.profiles (id),
    criado_em timestamptz not null default now()
  );

  create index cashback_lancamentos_cliente_id_idx on public.cashback_lancamentos (cliente_id);
  -- So pode existir UM cashback concedido por venda (o formulario do PDV so tem um campo) -- indice
  -- unico em vez de um check-then-insert sozinho fecha a corrida entre duas chamadas quase
  -- simultaneas pra mesma venda (achado no code-review, 2026-10-21: sem isso, um retry concorrente
  -- podia duplicar o credito antes de qualquer um dos dois terminar o insert).
  create unique index cashback_lancamentos_venda_origem_key on public.cashback_lancamentos (venda_origem_id);

  alter table public.cashback_lancamentos enable row level security;
  -- GRANT explicito (mesmo padrao de etiqueta_modelos/varejo_dividas_atacado) -- RLS so RESTRINGE um
  -- acesso que ja existe, nao concede nada sozinha; deixar explicito aqui em vez de depender so dos
  -- privilegios padrao do projeto Supabase (que ja cobrem "authenticated" nas tabelas novas, mas isso
  -- nao fica visivel no historico de migrations). SEM delete de proposito (achado no code-review,
  -- 2026-10-21): cashback_lancamentos e um historico -- um credito vira 'cancelado', nunca some; sem
  -- nenhuma function (nem cancelar_venda_varejo_com_cashback) precisando apagar linha nenhuma, nao ha
  -- motivo pra conceder esse privilegio.
  grant select, insert, update on public.cashback_lancamentos to authenticated;

  create policy "admin e vendedor gerenciam cashback_lancamentos da propria operacao"
    on public.cashback_lancamentos for all
    using (public.meu_papel() in ('admin', 'vendedor') and operacao_id = public.operacao_atual())
    with check (public.meu_papel() in ('admin', 'vendedor') and operacao_id = public.operacao_atual());

  -- RLS acima (FOR ALL admin/vendedor DA PROPRIA OPERACAO) deixa esses papeis inserir direto na
  -- tabela, sem passar por conceder_cashback -- um insert direto contornaria as regras que a
  -- function aplica (vencimento no futuro, cliente_id e operacao_id tem que ser os mesmos da venda
  -- de origem). Trigger replica essas regras DENTRO da tabela, pra valer em qualquer caminho de
  -- insercao, nao so via RPC (achado no code-review, 2026-10-21).
  create function public.validar_cashback_lancamento()
  returns trigger
  language plpgsql set search_path = public as $fn$
  declare
    v_venda public.vendas%rowtype;
  begin
    -- current_date sozinho usa o fuso da SESSAO do banco (UTC neste projeto, confirmado) -- entre
    -- 21h e 23h59 de Brasilia, UTC ja virou o dia seguinte, rejeitando/aceitando vencimentos um dia
    -- errado (mesma classe de bug que ja aconteceu neste projeto no lado do app, ver comentario de
    -- hojeIso() em src/lib/datas.ts -- "contas atrasadas cedo demais"; achado no code-review,
    -- 2026-10-21, agora no lado do banco). Mesmo idioma ja usado em outras migrations deste projeto
    -- (20260921000006, 20260923000001) pra converter pro fuso de Brasilia explicitamente.
    if new.vencimento <= (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Data de vencimento do cashback deve ser no futuro';
    end if;
    select * into v_venda from public.vendas where id = new.venda_origem_id;
    if v_venda.cliente_id is null or v_venda.cliente_id is distinct from new.cliente_id then
      raise exception 'cliente_id do cashback precisa ser o mesmo da venda de origem';
    end if;
    if v_venda.operacao_id is distinct from new.operacao_id then
      raise exception 'operacao_id do cashback precisa ser o mesmo da venda de origem';
    end if;
    return new;
  end
  $fn$;

  create trigger cashback_lancamentos_valida
    before insert on public.cashback_lancamentos
    for each row execute function public.validar_cashback_lancamento();

  -- A trigger acima so roda em INSERT -- a mesma RLS FOR ALL tambem libera UPDATE direto. So travar
  -- os 5 campos de identidade (versao anterior desta migration) nao bastava: um update direto ainda
  -- podia "reviver" um lancamento 'usado' de volta pra 'disponivel' (reusando o credito de graca,
  -- infinitas vezes) ou marcar 'usado' contra uma venda com desconto insuficiente -- pulando por
  -- cima da checagem que resgatar_cashback faz (achado no code-review, 2026-10-21). Esta trigger
  -- valida a TRANSICAO inteira (nao so os campos que nao podem mudar), pra qualquer update, nao so
  -- via RPC: reescreve/revalida as mesmas regras que resgatar_cashback/cancelar_venda_varejo_com_cashback
  -- ja aplicam, entao as chamadas legitimas dessas functions continuam passando sem mudanca nenhuma.
  create function public.validar_transicao_cashback_lancamento()
  returns trigger
  language plpgsql set search_path = public as $fn$
  declare
    v_venda public.vendas%rowtype;
  begin
    if new.cliente_id is distinct from old.cliente_id
       or new.venda_origem_id is distinct from old.venda_origem_id
       or new.operacao_id is distinct from old.operacao_id
       or new.valor is distinct from old.valor
       or new.vencimento is distinct from old.vencimento then
      raise exception 'cliente_id, venda_origem_id, operacao_id, valor e vencimento do cashback nao podem ser alterados depois de criado';
    end if;

    if old.situacao = new.situacao and new.usado_na_venda_id is not distinct from old.usado_na_venda_id then
      return new;
    end if;

    if old.situacao = 'disponivel' and new.situacao = 'usado' then
      -- Mesma regra de resgatar_cashback (dono + desconto suficiente), repetida aqui pra valer
      -- tambem num update direto que pule a function.
      if new.usado_na_venda_id is null then
        raise exception 'usado_na_venda_id e obrigatorio ao marcar um cashback como usado';
      end if;
      -- `for update` trava a venda contra outro update CONCORRENTE marcando um lancamento diferente
      -- como usado contra ela -- mesmo motivo do `for update` em resgatar_cashback (achado no
      -- code-review, 2026-10-21): sem isso, dois updates diretos quase simultaneos cairiam na mesma
      -- corrida que o fix em resgatar_cashback sozinho nao cobriria.
      select * into v_venda from public.vendas where id = new.usado_na_venda_id for update;
      if v_venda.cliente_id is distinct from new.cliente_id then
        raise exception 'Esse cashback pertence a outro cliente';
      end if;
      -- Soma o ja resgatado contra esta venda (exceto este proprio lancamento) -- checar so o valor
      -- deste lancamento isolado deixava dois resgates, cada um cabendo sozinho no desconto, serem
      -- aplicados juntos contra a mesma venda (achado no code-review, 2026-10-21 -- mesmo ajuste
      -- feito em resgatar_cashback).
      if v_venda.desconto_manual < public.cashback_resgatado_na_venda(new.usado_na_venda_id, new.id) + new.valor then
        raise exception 'O desconto da venda e menor que o cashback resgatado -- o cliente precisa receber o valor do cashback como desconto';
      end if;
      return new;
    end if;

    if old.situacao = 'usado' and new.situacao = 'disponivel' then
      -- So "devolve" o credito se a venda que consumiu foi REALMENTE cancelada (nao da pra reviver
      -- um resgate legitimo de graca) -- mesma pre-condicao que cancelar_venda_varejo_com_cashback
      -- so cumpre depois de ja ter chamado cancelar_venda.
      if new.usado_na_venda_id is not null or new.usado_em is not null then
        raise exception 'Ao devolver o cashback para disponivel, usado_na_venda_id e usado_em precisam ficar nulos';
      end if;
      select * into v_venda from public.vendas where id = old.usado_na_venda_id;
      if v_venda.status is distinct from 'cancelada' then
        raise exception 'So e possivel devolver um cashback usado se a venda que consumiu ele foi cancelada';
      end if;
      -- Cascata (achado no code-review, 2026-10-21): se a venda que CONCEDEU este credito (nao a que
      -- consumiu) TAMBEM ja foi cancelada antes, devolver pra 'disponivel' ressuscitaria um credito
      -- cuja origem foi desfeita -- o cliente podia gastar um cashback de uma venda que nunca
      -- aconteceu de verdade. Nesse caso tem que ir pra 'cancelado', nao 'disponivel' (ver transicao
      -- usado -> cancelado logo abaixo; cancelar_venda_varejo_com_cashback decide qual das duas usar).
      select * into v_venda from public.vendas where id = new.venda_origem_id;
      if v_venda.status = 'cancelada' then
        raise exception 'Esse cashback nao pode voltar para disponivel -- a venda que concedeu ele tambem foi cancelada (use a transicao para cancelado)';
      end if;
      return new;
    end if;

    if old.situacao = 'disponivel' and new.situacao = 'cancelado' then
      -- So cancela o credito concedido se a venda de origem foi REALMENTE cancelada.
      select * into v_venda from public.vendas where id = new.venda_origem_id;
      if v_venda.status is distinct from 'cancelada' then
        raise exception 'So e possivel cancelar um cashback concedido se a venda de origem foi cancelada';
      end if;
      return new;
    end if;

    if old.situacao = 'usado' and new.situacao = 'cancelado' then
      -- Mesma cascata do bloco usado->disponivel acima, so que pelo caminho correto: a venda que
      -- consumiu E a venda que concedeu foram as duas canceladas -- o credito vira cancelado, nunca
      -- disponivel de novo.
      if new.usado_na_venda_id is not null or new.usado_em is not null then
        raise exception 'Ao cancelar um cashback usado, usado_na_venda_id e usado_em precisam ficar nulos';
      end if;
      select * into v_venda from public.vendas where id = old.usado_na_venda_id;
      if v_venda.status is distinct from 'cancelada' then
        raise exception 'So e possivel cancelar um cashback usado se a venda que consumiu ele foi cancelada';
      end if;
      select * into v_venda from public.vendas where id = new.venda_origem_id;
      if v_venda.status is distinct from 'cancelada' then
        raise exception 'So e possivel cancelar (em vez de devolver) um cashback usado se a venda de origem tambem foi cancelada';
      end if;
      return new;
    end if;

    raise exception 'Transicao de situacao invalida em cashback_lancamentos (de % para %)', old.situacao, new.situacao;
  end
  $fn$;

  create trigger cashback_lancamentos_valida_transicao
    before update on public.cashback_lancamentos
    for each row execute function public.validar_transicao_cashback_lancamento();

  -- Concede cashback pro cliente de uma venda ja fechada -- chamado encadeado pelo app logo depois
  -- de registrar_venda ter sucesso (mesmo padrao de registrar_compra_atacado_varejo). O cliente vem
  -- SEMPRE da propria venda (vendas.cliente_id), nunca de um parametro solto -- fecha a brecha de um
  -- vendedor conceder cashback pra um cliente diferente do que realmente comprou.
  create function public.conceder_cashback(p_venda_id uuid, p_valor numeric, p_vencimento date)
  returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_venda public.vendas%rowtype;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    select * into v_venda from public.vendas where id = p_venda_id and operacao_id = v_op;
    if not found then
      raise exception 'Venda nao encontrada';
    end if;
    if v_venda.cliente_id is null then
      raise exception 'Essa venda nao tem cliente vinculado -- nao e possivel conceder cashback';
    end if;

    if p_valor is null or p_valor <= 0 then
      raise exception 'Valor do cashback deve ser maior que zero';
    end if;
    -- current_date usa o fuso da sessao do banco (UTC) -- converte pro fuso de Brasilia explicito,
    -- mesma razao do comentario em validar_cashback_lancamento acima.
    if p_vencimento is null or p_vencimento <= (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Data de vencimento do cashback deve ser no futuro';
    end if;

    -- Retry idempotente (achado no code-review, 2026-10-21): registrar_venda_varejo_com_cashback e
    -- chamada com o MESMO p_idempotency_key quando o app reenvia a venda depois de uma resposta
    -- perdida (timeout). registrar_venda ja devolve a venda existente sem repetir nada -- mas sem
    -- isso, conceder_cashback rodaria de novo e duplicaria o credito pro cliente. So pode existir UM
    -- cashback concedido por venda (o formulario do PDV so tem um campo) -- o INDICE UNICO em
    -- venda_origem_id (nao um check-then-insert sozinho, que tem uma janela de corrida entre duas
    -- chamadas quase simultaneas) e quem garante isso; aqui so trata a violacao dele devolvendo o
    -- lancamento ja existente em vez de propagar o erro.
    begin
      insert into public.cashback_lancamentos (cliente_id, venda_origem_id, operacao_id, valor, vencimento, criado_por)
      values (v_venda.cliente_id, p_venda_id, v_op, public.arredondar_moeda(p_valor), p_vencimento, auth.uid())
      returning id into v_id;
    exception
      when unique_violation then
        select id into v_id from public.cashback_lancamentos where venda_origem_id = p_venda_id;
    end;

    return v_id;
  end
  $fn$;

  revoke execute on function public.conceder_cashback(uuid, numeric, date) from public, anon;
  grant execute on function public.conceder_cashback(uuid, numeric, date) to authenticated;

  -- Quanto cashback JA foi resgatado contra uma venda (soma os lancamentos ja 'usado' com
  -- usado_na_venda_id = a venda, exceto o proprio lancamento sendo avaliado, se informado). Usado por
  -- resgatar_cashback E pela trigger de transicao -- as duas precisam checar o ACUMULADO, nao so o
  -- valor do lancamento isolado (achado no code-review, 2026-10-21: checar cada resgate contra
  -- desconto_manual isoladamente deixava DOIS lancamentos, cada um <= desconto_manual sozinho, serem
  -- resgatados contra a MESMA venda, somando mais credito consumido do que o desconto real dado).
  create function public.cashback_resgatado_na_venda(p_venda_id uuid, p_excluir_id uuid default null)
  returns numeric
  language sql stable set search_path = public as $fn$
    select coalesce(sum(valor), 0) from public.cashback_lancamentos
     where usado_na_venda_id = p_venda_id and situacao = 'usado' and id is distinct from p_excluir_id;
  $fn$;

  -- Marca um cashback disponivel como usado -- chamado encadeado pelo app logo depois de
  -- registrar_venda ter sucesso NA VENDA ATUAL, que ja saiu com o desconto do cashback embutido no
  -- p_valor_desconto (o app resolve isso ANTES de finalizar, ver DECISIONS.md). Trava por
  -- `for update` + `where situacao = 'disponivel'` no update (mesma idempotencia de
  -- receber_crediario): clique duplo no "usar" nao desconta duas vezes.
  create function public.resgatar_cashback(p_lancamento_id uuid, p_venda_id uuid)
  returns numeric
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_venda public.vendas%rowtype;
    v_lanc public.cashback_lancamentos%rowtype;
    v_linhas integer;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    -- `for update` na venda (nao so no lancamento) e o que serializa dois resgates CONCORRENTES
    -- contra a MESMA venda -- sem isso, duas chamadas quase simultaneas pra lancamentos diferentes
    -- (cada um sozinho cabendo no desconto) passavam as duas pela checagem de desconto ACUMULADO
    -- antes de qualquer uma comitar, porque cada uma so travava sua PROPRIA linha de cashback_lancamentos,
    -- nao a venda que as duas estavam disputando (achado no code-review, 2026-10-21 -- corrida real
    -- de concorrencia, nao pega pelo T16 porque o teste roda sequencial, nunca duas transacoes
    -- abertas ao mesmo tempo). Mesmo padrao ja usado em registrar_venda pra caixa_sessoes.
    select * into v_venda from public.vendas where id = p_venda_id and operacao_id = v_op for update;
    if not found then
      raise exception 'Venda nao encontrada';
    end if;

    select l.* into v_lanc from public.cashback_lancamentos l
      join public.vendas vo on vo.id = l.venda_origem_id
     where l.id = p_lancamento_id and vo.operacao_id = v_op
     for update;
    if not found then
      raise exception 'Cashback nao encontrado';
    end if;

    -- Retry idempotente (achado no code-review, 2026-10-21): mesma situacao do conceder_cashback
    -- acima -- se este MESMO lancamento ja foi resgatado por esta MESMA venda (reenvio depois de
    -- resposta perdida), devolve sucesso de novo em vez de falhar com "ja foi usado", que confundiria
    -- o vendedor fazendo achar que a venda (que ja tinha ido com sucesso) deu erro.
    if v_lanc.situacao = 'usado' and v_lanc.usado_na_venda_id = p_venda_id then
      return v_lanc.valor;
    end if;

    if v_lanc.situacao <> 'disponivel' then
      raise exception 'Esse cashback ja foi usado ou cancelado';
    end if;
    -- Limite de validade com `<` (nao `<=`) de proposito: conceder_cashback/a trigger exigem
    -- vencimento ESTRITAMENTE futuro (concede-lo ja vencendo hoje nao daria janela nenhuma pro
    -- cliente usar), mas resgatar no proprio dia em que vence ainda e um uso legitimo -- rejeitar
    -- "hoje" aqui seria mais restritivo do que o cliente esperaria de "vence em tal dia". E usa o
    -- fuso de Brasilia explicito (nao current_date puro, que e UTC nesta sessao) -- senao, entre 21h
    -- e 23h59 de Brasilia, um cashback que vence hoje (ainda valido pro cliente) seria rejeitado como
    -- vencido um dia antes da hora (achado no code-review, 2026-10-21).
    if v_lanc.vencimento < (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Esse cashback ja venceu';
    end if;
    if v_lanc.cliente_id is distinct from v_venda.cliente_id then
      raise exception 'Esse cashback pertence a outro cliente';
    end if;
    -- Achado no code-review, 2026-10-21: resgatar_cashback e grantada direto pra "authenticated"
    -- (nao so chamada por dentro do wrapper) -- sem esta checagem, uma chamada direta (fora do
    -- wrapper, ex: via devtools) com p_venda_id de uma venda de preco cheio marcaria o cashback como
    -- usado sem o cliente ter recebido desconto nenhum. vendas.desconto_manual e onde
    -- registrar_venda grava o p_valor_desconto que de fato foi aplicado na venda (ja comitado neste
    -- ponto, por isso le o valor persistido em vez de confiar num parametro) -- tem que cobrir pelo
    -- menos o valor deste cashback MAIS qualquer outro ja resgatado contra a mesma venda (achado no
    -- code-review, 2026-10-21: checar so este lancamento isolado deixava DOIS resgates, cada um
    -- cabendo sozinho no desconto, serem aplicados juntos contra a mesma venda, consumindo mais
    -- credito do que o desconto real dado).
    if v_venda.desconto_manual < public.cashback_resgatado_na_venda(p_venda_id, p_lancamento_id) + v_lanc.valor then
      raise exception 'O desconto da venda (%) e menor que o cashback resgatado (%) -- o cliente precisa receber o valor do cashback como desconto', v_venda.desconto_manual, v_lanc.valor;
    end if;

    update public.cashback_lancamentos
       set situacao = 'usado', usado_na_venda_id = p_venda_id, usado_em = now()
     where id = p_lancamento_id and situacao = 'disponivel';

    get diagnostics v_linhas = row_count;
    if v_linhas = 0 then
      raise exception 'Esse cashback ja foi usado ou cancelado';
    end if;

    return v_lanc.valor;
  end
  $fn$;

  revoke execute on function public.resgatar_cashback(uuid, uuid) from public, anon;
  grant execute on function public.resgatar_cashback(uuid, uuid) to authenticated;

  -- Wrapper atomico (achado no code-review, 2026-10-21): chamar registrar_venda e depois
  -- resgatar_cashback/conceder_cashback como DUAS chamadas RPC separadas do app deixava uma janela
  -- real -- se a venda tivesse sucesso mas o resgate falhasse depois (ex: outra venda consumiu o
  -- mesmo lancamento um instante antes), a venda ja saia com o desconto do cashback embutido e o
  -- lancamento continuava 'disponivel', dando ao cliente o desconto E o credito pra usar nao-usado de
  -- novo. Esta function faz as tres chamadas (registrar_venda + resgatar_cashback opcional +
  -- conceder_cashback opcional) dentro de UMA SO transacao -- se qualquer uma falhar, a venda tambem
  -- nao e criada (plpgsql propaga a excecao do `perform` e aborta tudo). O app agora chama SEMPRE
  -- esta function (os 3 parametros de cashback vem null quando a venda nao usa cashback nenhum --
  -- comportamento identico a chamar registrar_venda direto).
  create function public.registrar_venda_varejo_com_cashback(
    p_sessao_id uuid, p_itens jsonb, p_pagamentos jsonb, p_idempotency_key uuid default null::uuid,
    p_cliente_nome text default null::text, p_cliente_documento text default null::text,
    p_autorizacao_desconto_id uuid default null::uuid, p_autorizacao_estoque_id uuid default null::uuid,
    p_valor_desconto numeric default 0, p_valor_acrescimo numeric default 0,
    p_cliente_id uuid default null::uuid,
    p_cashback_resgatar_id uuid default null::uuid,
    p_cashback_conceder_valor numeric default null::numeric,
    p_cashback_conceder_vencimento date default null::date
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_venda_id uuid;
    v_valor_resgatado numeric;
  begin
    v_venda_id := public.registrar_venda(
      p_sessao_id, p_itens, p_pagamentos, p_idempotency_key,
      p_cliente_nome, p_cliente_documento, p_autorizacao_desconto_id, p_autorizacao_estoque_id,
      p_valor_desconto, p_valor_acrescimo, p_cliente_id
    );

    if p_cashback_resgatar_id is not null then
      v_valor_resgatado := public.resgatar_cashback(p_cashback_resgatar_id, v_venda_id);
      -- Achado no code-review, 2026-10-21: resgatar_cashback so marca o lancamento como usado -- nao
      -- garante, sozinho, que o cliente REALMENTE recebeu esse valor como desconto na venda (o app
      -- server action e chamavel diretamente, com qualquer p_valor_desconto). Sem esta checagem, uma
      -- chamada com p_cashback_resgatar_id preenchido mas p_valor_desconto menor (ou zero) consumiria
      -- o credito do cliente sem dar o desconto correspondente.
      if p_valor_desconto < v_valor_resgatado then
        raise exception 'O desconto da venda (%) e menor que o cashback resgatado (%) -- o cliente precisa receber o valor do cashback como desconto', p_valor_desconto, v_valor_resgatado;
      end if;
    end if;

    if p_cashback_conceder_valor is not null and p_cashback_conceder_valor > 0 then
      perform public.conceder_cashback(v_venda_id, p_cashback_conceder_valor, p_cashback_conceder_vencimento);
    end if;

    return v_venda_id;
  end
  $fn$;

  revoke execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date
  ) from public, anon;
  grant execute on function public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date
  ) to authenticated;

  -- Cancelamento tambem precisa reconciliar cashback (achado no code-review, 2026-10-21):
  -- cancelar_venda (ja existente, 20260921000005) reverte estoque/caixa mas nao sabia de cashback
  -- (nao existia ainda quando foi escrita) -- sem isso, cancelar uma venda que tinha RESGATADO
  -- cashback perdia o credito do cliente pra sempre, e cancelar uma venda que tinha CONCEDIDO
  -- cashback deixava a loja devendo um credito de uma venda que nunca aconteceu de verdade. Mesmo
  -- padrao do wrapper de venda: NAO MUDA cancelar_venda, so compoe ela com a reconciliacao, atomico.
  -- Se o credito concedido ja tiver sido gasto numa venda POSTERIOR antes deste cancelamento, fica
  -- como esta por enquanto (o credito continua 'usado', preso aquela venda) -- MAS cancelar essa
  -- venda-que-consumiu depois (em qualquer ordem) ja sabe que a origem tambem foi cancelada e manda o
  -- credito pra 'cancelado' em vez de ressuscitar pra 'disponivel' (cascata de 2 cancelamentos,
  -- testada no T17 -- achado de code-review, 2026-10-21: devolver cegamente pra 'disponivel' deixava
  -- o cliente gastar de novo um cashback cuja venda de origem ja tinha sido desfeita).
  create function public.cancelar_venda_varejo_com_cashback(p_venda_id uuid, p_motivo text, p_autorizacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform public.cancelar_venda(p_venda_id, p_motivo, p_autorizacao_id);

    -- Credito(s) RESGATADO(S) nesta venda: volta pra 'disponivel' -- EXCETO se a venda que concedeu
    -- aquele credito (venda_origem_id, nao esta venda) tambem ja estiver cancelada -- nesse caso o
    -- credito vira 'cancelado' direto, nunca ressuscita (achado no code-review, 2026-10-21: devolver
    -- cegamente pra 'disponivel' deixava o cliente gastar um cashback cuja venda de origem ja tinha
    -- sido desfeita). A trigger de transicao valida as duas pernas desse CASE de qualquer forma --
    -- aqui so decide qual das duas pedir.
    update public.cashback_lancamentos l
       set situacao = case when vo.status = 'cancelada' then 'cancelado' else 'disponivel' end,
           usado_na_venda_id = null, usado_em = null
      from public.vendas vo
     where l.usado_na_venda_id = p_venda_id and l.situacao = 'usado' and vo.id = l.venda_origem_id;

    -- Credito(s) CONCEDIDO(S) por esta venda, ainda 'disponivel' (nunca foram gastos): cancela.
    update public.cashback_lancamentos
       set situacao = 'cancelado'
     where venda_origem_id = p_venda_id and situacao = 'disponivel';
  end
  $fn$;

  revoke execute on function public.cancelar_venda_varejo_com_cashback(uuid, text, uuid) from public, anon;
  grant execute on function public.cancelar_venda_varejo_com_cashback(uuid, text, uuid) to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regclass('public.cashback_lancamentos') is null then
    raise exception 'FALHA: tabela cashback_lancamentos nao existe';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cashback_lancamentos' and column_name = 'operacao_id') then
    raise exception 'FALHA: cashback_lancamentos.operacao_id nao existe';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'cashback_lancamentos_venda_origem_key') then
    raise exception 'FALHA: indice unico cashback_lancamentos_venda_origem_key nao existe';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'cashback_lancamentos' and c.relrowsecurity
  ) then
    raise exception 'FALHA: RLS nao esta habilitado em cashback_lancamentos';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cashback_lancamentos') then
    raise exception 'FALHA: nenhuma policy em cashback_lancamentos';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cashback_lancamentos_valida' and not tgisinternal) then
    raise exception 'FALHA: trigger cashback_lancamentos_valida nao existe';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cashback_lancamentos_valida_transicao' and not tgisinternal) then
    raise exception 'FALHA: trigger cashback_lancamentos_valida_transicao nao existe';
  end if;
  if to_regprocedure('public.conceder_cashback(uuid, numeric, date)') is null then
    raise exception 'FALHA: conceder_cashback nao existe';
  end if;
  if to_regprocedure('public.cashback_resgatado_na_venda(uuid, uuid)') is null then
    raise exception 'FALHA: cashback_resgatado_na_venda nao existe';
  end if;
  if to_regprocedure('public.resgatar_cashback(uuid, uuid)') is null then
    raise exception 'FALHA: resgatar_cashback nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.conceder_cashback(uuid, numeric, date)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em conceder_cashback';
  end if;
  if has_function_privilege('anon', 'public.conceder_cashback(uuid, numeric, date)', 'execute') then
    raise exception 'FALHA: anon com execute em conceder_cashback';
  end if;
  if not has_function_privilege('authenticated', 'public.resgatar_cashback(uuid, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em resgatar_cashback';
  end if;
  if has_function_privilege('anon', 'public.resgatar_cashback(uuid, uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em resgatar_cashback';
  end if;
  if to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date)') is null then
    raise exception 'FALHA: registrar_venda_varejo_com_cashback nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em registrar_venda_varejo_com_cashback';
  end if;
  if has_function_privilege('anon', 'public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date)', 'execute') then
    raise exception 'FALHA: anon com execute em registrar_venda_varejo_com_cashback';
  end if;
  if to_regprocedure('public.cancelar_venda_varejo_com_cashback(uuid, text, uuid)') is null then
    raise exception 'FALHA: cancelar_venda_varejo_com_cashback nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.cancelar_venda_varejo_com_cashback(uuid, text, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em cancelar_venda_varejo_com_cashback';
  end if;
  if has_function_privilege('anon', 'public.cancelar_venda_varejo_com_cashback(uuid, text, uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em cancelar_venda_varejo_com_cashback';
  end if;

  raise notice 'VERIFICACAO OK: tabela, RLS, triggers e as 5 functions de cashback no lugar, com grants corretos.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod uuid;
  v_var uuid;
  v_cliente uuid;
  v_outro_cliente uuid;
  v_venda1 uuid;
  v_venda2 uuid;
  v_venda3 uuid;
  v_lanc uuid;
  v_valor_resgatado numeric;
  v_n int;
  v_contagem_antes bigint;
  v_contagem_depois bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  insert into public.clientes (nome, telefone) values ('ZZ ENSAIO CLIENTE CASHBACK', '35988887777') returning id into v_cliente;
  insert into public.clientes (nome, telefone) values ('ZZ ENSAIO OUTRO CLIENTE', '35977776666') returning id into v_outro_cliente;

  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO VENDA CASHBACK', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ011', 'atributos', '{}'::jsonb, 'preco_venda', 100.00)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var, 10, 20.00, 'ensaio cashback');

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;

  -- Venda 1: gera o cashback a conceder
  v_venda1 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
    gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
  );

  -- T1. Conceder cashback exige cliente vinculado na venda
  begin
    perform public.conceder_cashback(v_venda1, 10.00, current_date - 1);
    raise exception 'TESTE FALHOU [T1-a]: vencimento no passado deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm <> 'Data de vencimento do cashback deve ser no futuro' then raise; end if;
  end;

  v_lanc := public.conceder_cashback(v_venda1, 10.00, current_date + 30);
  select count(*) into v_n from public.cashback_lancamentos where id = v_lanc and cliente_id = v_cliente and situacao = 'disponivel' and valor = 10.00;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1-b]: cashback nao foi concedido corretamente'; end if;

  -- T2. Venda 2 do MESMO cliente resgata o cashback concedido na venda 1
  v_venda2 := public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 90.00)),
    gen_random_uuid(), null, null, null, null, 10.00, 0, v_cliente
  );
  v_valor_resgatado := public.resgatar_cashback(v_lanc, v_venda2);
  if v_valor_resgatado <> 10.00 then raise exception 'TESTE FALHOU [T2-a]: valor resgatado incorreto'; end if;
  select count(*) into v_n from public.cashback_lancamentos where id = v_lanc and situacao = 'usado' and usado_na_venda_id = v_venda2;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2-b]: cashback nao marcou como usado'; end if;

  -- T3. Resgatar de novo (clique duplo) falha -- ja nao esta mais disponivel
  begin
    perform public.resgatar_cashback(v_lanc, v_venda2);
    raise exception 'TESTE FALHOU [T3]: resgatar um cashback ja usado deveria falhar';
  exception
    when others then
      if sqlerrm <> 'Esse cashback ja foi usado ou cancelado' then raise; end if;
  end;

  -- T6. Wrapper atomico (registrar_venda_varejo_com_cashback): cria a venda E concede cashback numa
  -- chamada so -- caminho feliz.
  v_venda3 := public.registrar_venda_varejo_com_cashback(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
    gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
    null, 15.00, current_date + 30
  );
  select count(*) into v_n from public.cashback_lancamentos where venda_origem_id = v_venda3 and valor = 15.00 and situacao = 'disponivel';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T6]: wrapper nao concedeu o cashback junto com a venda'; end if;

  -- T7. Wrapper e atomico de verdade: se o resgate (encadeado DENTRO da mesma chamada) falhar, a
  -- venda tambem nao e criada -- v_lanc aqui ja esta 'usado' desde o T2/T3, resgatar de novo tem que
  -- falhar, e NENHUMA venda nova pode sobrar (antes do fix, a venda commitava e so o resgate falhava).
  select count(*) into v_contagem_antes from public.vendas;
  begin
    perform public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
      v_lanc, null, null
    );
    raise exception 'TESTE FALHOU [T7]: resgate de cashback ja usado dentro do wrapper deveria ter falhado';
  exception
    when others then
      if sqlerrm <> 'Esse cashback ja foi usado ou cancelado' then raise; end if;
  end;
  select count(*) into v_contagem_depois from public.vendas;
  if v_contagem_depois <> v_contagem_antes then
    raise exception 'TESTE FALHOU [T7]: venda foi criada mesmo com o resgate de cashback falhando dentro do wrapper (nao atomico)';
  end if;

  -- T4. Cashback de um cliente nao pode ser resgatado numa venda de OUTRO cliente -- usa uma venda
  -- PROPRIA pra conceder (nao v_venda1, que ja tem o cashback do T1: o retry idempotente de
  -- conceder_cashback, achado no code-review, devolve o lancamento EXISTENTE quando ja existe
  -- qualquer um pra aquela venda_origem_id -- reusar v_venda1 aqui devolveria o cashback do T1 em vez
  -- de criar um novo).
  declare
    v_venda4 uuid;
  begin
    v_venda4 := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
    );
    v_lanc := public.conceder_cashback(v_venda4, 5.00, current_date + 30);
  end;
  declare
    v_venda_outro uuid;
  begin
    v_venda_outro := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_outro_cliente
    );
    begin
      perform public.resgatar_cashback(v_lanc, v_venda_outro);
      raise exception 'TESTE FALHOU [T4]: resgatar cashback de outro cliente deveria falhar';
    exception
      when others then
        if sqlerrm <> 'Esse cashback pertence a outro cliente' then raise; end if;
    end;
  end;

  -- T14. resgatar_cashback e grantada direto (nao so por dentro do wrapper) -- chamada direta contra
  -- uma venda do MESMO cliente mas SEM desconto nenhum (bypassando o wrapper, que garantiria o
  -- desconto antes de chamar) tem que falhar -- o cliente nao pode "perder" o credito sem receber o
  -- desconto correspondente (achado no code-review, 2026-10-21).
  declare
    v_venda_sem_desconto uuid;
  begin
    v_venda_sem_desconto := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
    );
    begin
      perform public.resgatar_cashback(v_lanc, v_venda_sem_desconto);
      raise exception 'TESTE FALHOU [T14]: resgatar cashback direto numa venda sem desconto correspondente deveria falhar';
    exception
      when others then
        if sqlerrm !~ 'e menor que o cashback resgatado' then raise; end if;
    end;
  end;

  -- T5. Insert DIRETO na tabela (contornando conceder_cashback) tambem e bloqueado -- a trigger
  -- replica a regra "cliente_id tem que ser o mesmo da venda de origem" pra qualquer caminho de
  -- insercao, nao so via RPC (achado no code-review: RLS admin/vendedor sozinha nao impedia um
  -- insert direto fora dessa regra).
  begin
    insert into public.cashback_lancamentos (cliente_id, venda_origem_id, operacao_id, valor, vencimento)
    values (v_outro_cliente, v_venda1, v_varejo, 7.00, current_date + 30);
    raise exception 'TESTE FALHOU [T5]: insert direto com cliente_id diferente da venda deveria ter sido bloqueado pela trigger';
  exception
    when others then
      if sqlerrm <> 'cliente_id do cashback precisa ser o mesmo da venda de origem' then raise; end if;
  end;

  -- T8. Update DIRETO reatribuindo o cashback pra outro cliente (ou mudando valor/vencimento)
  -- tambem e bloqueado -- RLS FOR ALL libera update, so so o insert tinha trigger (achado no
  -- code-review: a regra "cliente_id tem que ser o da venda" nao valia pra update nenhum). v_lanc
  -- aqui e o cashback de 5.00 concedido no T4, que continua 'disponivel' (o resgate do T4 falhou
  -- antes de chegar no update).
  begin
    update public.cashback_lancamentos set cliente_id = v_outro_cliente where id = v_lanc;
    raise exception 'TESTE FALHOU [T8]: update direto reatribuindo cliente_id deveria ter sido bloqueado pela trigger';
  exception
    when others then
      if sqlerrm <> 'cliente_id, venda_origem_id, operacao_id, valor e vencimento do cashback nao podem ser alterados depois de criado' then raise; end if;
  end;

  -- T9. Retry idempotente: se o app reenvia a MESMA chamada (mesmo idempotency_key) depois de uma
  -- resposta perdida, conceder_cashback nao duplica o credito -- devolve o mesmo lancamento de novo.
  declare
    v_chave_t9 uuid := gen_random_uuid();
    v_venda_t9a uuid;
    v_venda_t9b uuid;
    v_qtd int;
  begin
    v_venda_t9a := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      v_chave_t9, null, null, null, null, 0, 0, v_cliente,
      null, 8.00, current_date + 30
    );
    v_venda_t9b := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      v_chave_t9, null, null, null, null, 0, 0, v_cliente,
      null, 8.00, current_date + 30
    );
    if v_venda_t9a <> v_venda_t9b then
      raise exception 'TESTE FALHOU [T9]: retry com mesma idempotency_key deveria devolver a MESMA venda';
    end if;
    select count(*) into v_qtd from public.cashback_lancamentos where venda_origem_id = v_venda_t9a and valor = 8.00;
    if v_qtd <> 1 then
      raise exception 'TESTE FALHOU [T9]: retry duplicou o cashback concedido (esperava 1 lancamento, achou %)', v_qtd;
    end if;
  end;

  -- T10. Retry idempotente do resgate: reenviar a MESMA chamada (mesmo idempotency_key) nao falha
  -- com "ja foi usado" (que confundiria o vendedor achando que a venda deu erro, quando ja tinha ido
  -- com sucesso) -- devolve a mesma venda de novo, e o cashback continua marcado como usado por ela.
  declare
    v_chave_t10 uuid := gen_random_uuid();
    v_venda_t10a uuid;
    v_venda_t10b uuid;
    v_qtd int;
  begin
    v_venda_t10a := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 95.00)),
      v_chave_t10, null, null, null, null, 5.00, 0, v_cliente,
      v_lanc, null, null
    );
    v_venda_t10b := public.registrar_venda_varejo_com_cashback(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 95.00)),
      v_chave_t10, null, null, null, null, 5.00, 0, v_cliente,
      v_lanc, null, null
    );
    if v_venda_t10a <> v_venda_t10b then
      raise exception 'TESTE FALHOU [T10]: retry com mesma idempotency_key deveria devolver a MESMA venda';
    end if;
    select count(*) into v_qtd from public.cashback_lancamentos
     where id = v_lanc and situacao = 'usado' and usado_na_venda_id = v_venda_t10a;
    if v_qtd <> 1 then
      raise exception 'TESTE FALHOU [T10]: cashback nao ficou marcado como usado pela venda certa apos o retry';
    end if;
  end;

  -- T15. Update DIRETO "revivendo" um cashback ja usado (bypassando cancelar_venda_varejo_com_cashback)
  -- e bloqueado -- so pode devolver pra 'disponivel' se a venda que consumiu foi REALMENTE cancelada
  -- (achado no code-review, 2026-10-21: travar so os campos de identidade nao impedia reusar o
  -- credito de graca via update direto em situacao/usado_na_venda_id/usado_em). v_lanc aqui e o
  -- cashback de 5.00, marcado 'usado' no T10 -- a venda que o consumiu nunca foi cancelada.
  begin
    update public.cashback_lancamentos
       set situacao = 'disponivel', usado_na_venda_id = null, usado_em = null
     where id = v_lanc;
    raise exception 'TESTE FALHOU [T15]: update direto "revivendo" um cashback usado deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm <> 'So e possivel devolver um cashback usado se a venda que consumiu ele foi cancelada' then raise; end if;
  end;

  -- T16. Dois lancamentos, cada um sozinho dentro do desconto da venda, nao podem ser resgatados
  -- JUNTOS contra a mesma venda se a soma passar do desconto real dado (achado no code-review,
  -- 2026-10-21: checar cada resgate isoladamente contra desconto_manual, sem somar o que ja foi
  -- resgatado antes, deixava o credito total consumido passar do desconto de verdade).
  declare
    v_venda_dupla uuid;
    v_lanc_a uuid;
    v_lanc_b uuid;
    v_venda_doadora_a uuid;
    v_venda_doadora_b uuid;
  begin
    v_venda_doadora_a := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
    );
    v_lanc_a := public.conceder_cashback(v_venda_doadora_a, 25.00, current_date + 30);
    v_venda_doadora_b := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
    );
    v_lanc_b := public.conceder_cashback(v_venda_doadora_b, 25.00, current_date + 30);

    -- Venda com desconto_manual = 40 -- cada lancamento (25.00) cabe sozinho, mas os dois JUNTOS (50)
    -- passam do desconto real dado.
    v_venda_dupla := public.registrar_venda(
      v_sessao,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 60.00)),
      gen_random_uuid(), null, null, null, null, 40.00, 0, v_cliente
    );
    perform public.resgatar_cashback(v_lanc_a, v_venda_dupla);
    begin
      perform public.resgatar_cashback(v_lanc_b, v_venda_dupla);
      raise exception 'TESTE FALHOU [T16]: segundo resgate contra a mesma venda deveria ter sido bloqueado (soma passa do desconto)';
    exception
      when others then
        if sqlerrm !~ 'e menor que o cashback resgatado' then raise; end if;
    end;

    -- Mesma checagem, agora via UPDATE DIRETO (bypassando resgatar_cashback) -- a trigger tem que
    -- bloquear igual.
    begin
      update public.cashback_lancamentos
         set situacao = 'usado', usado_na_venda_id = v_venda_dupla, usado_em = now()
       where id = v_lanc_b;
      raise exception 'TESTE FALHOU [T16]: update direto duplicando o resgate contra a mesma venda deveria ter sido bloqueado';
    exception
      when others then
        if sqlerrm <> 'O desconto da venda e menor que o cashback resgatado -- o cliente precisa receber o valor do cashback como desconto' then raise; end if;
    end;
  end;

  -- T11/T12. Cancelamento reconcilia cashback (cancelar_venda_varejo_com_cashback) -- cancelar_venda
  -- exige um supervisor DIFERENTE do operador pra autorizar; Barbara (vendedora real do Varejo,
  -- ja vinculada a esta operacao) abre um caixa PROPRIO pra isso -- o caixa real (CAIXA 1) ja esta
  -- ocupado pela sessao real de Lucas desde 2026-09-23, entao usa um caixa temporario (some no
  -- rollback do ensaio).
  declare
    v_caixa_barbara uuid;
    v_sessao_barbara uuid;
    v_venda_grant uuid;
    v_venda_origem_resgate uuid;
    v_venda_resgate uuid;
    v_lanc_grant uuid;
    v_lanc_resgate uuid;
    v_json jsonb;
    v_qtd int;
  begin
    -- "caixas" (diferente de caixa_sessoes) nao tem trigger de auto-preenchimento de operacao_id, e
    -- so admin pode gerenciar (RLS "admin gerencia caixas") -- cria o caixa temporario AINDA como
    -- v_lucas (admin), antes de trocar pra Barbara (vendedora) pra abrir a sessao nele.
    perform public.definir_pin_supervisor(v_lucas, '1234');
    insert into public.caixas (operacao_id, nome, deposito_id) values (v_varejo, 'ZZ ENSAIO CAIXA CANCELAMENTO', v_dep) returning id into v_caixa_barbara;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    execute 'set local role authenticated';

    v_sessao_barbara := public.abrir_sessao_caixa(v_caixa_barbara, 0);

    -- T11. Cancelar uma venda que CONCEDEU cashback -- o credito vira 'cancelado' (a loja nao fica
    -- devendo um credito de uma venda que nunca aconteceu de verdade).
    v_venda_grant := public.registrar_venda_varejo_com_cashback(
      v_sessao_barbara,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
      null, 12.00, current_date + 30
    );
    select id into v_lanc_grant from public.cashback_lancamentos where venda_origem_id = v_venda_grant and valor = 12.00;
    v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_venda_grant);
    perform public.cancelar_venda_varejo_com_cashback(v_venda_grant, 'ensaio cancelamento com cashback concedido', (v_json ->> 'autorizacao_id')::uuid);
    select count(*) into v_qtd from public.cashback_lancamentos where id = v_lanc_grant and situacao = 'cancelado';
    if v_qtd <> 1 then
      raise exception 'TESTE FALHOU [T11]: cashback concedido nao foi cancelado junto com a venda';
    end if;

    -- T12. Cancelar uma venda que RESGATOU cashback -- o credito volta a ficar 'disponivel' (o
    -- cliente nao gastou de verdade, a venda foi desfeita).
    v_venda_origem_resgate := public.registrar_venda(
      v_sessao_barbara,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
      gen_random_uuid(), null, null, null, null, 0, 0, v_cliente
    );
    v_lanc_resgate := public.conceder_cashback(v_venda_origem_resgate, 20.00, current_date + 30);
    v_venda_resgate := public.registrar_venda_varejo_com_cashback(
      v_sessao_barbara,
      jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
      jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 80.00)),
      gen_random_uuid(), null, null, null, null, 20.00, 0, v_cliente,
      v_lanc_resgate, null, null
    );
    select count(*) into v_qtd from public.cashback_lancamentos
     where id = v_lanc_resgate and situacao = 'usado' and usado_na_venda_id = v_venda_resgate;
    if v_qtd <> 1 then raise exception 'TESTE FALHOU [T12]: resgate preliminar nao registrou como esperado'; end if;

    v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_venda_resgate);
    perform public.cancelar_venda_varejo_com_cashback(v_venda_resgate, 'ensaio cancelamento com cashback resgatado', (v_json ->> 'autorizacao_id')::uuid);
    select count(*) into v_qtd from public.cashback_lancamentos
     where id = v_lanc_resgate and situacao = 'disponivel' and usado_na_venda_id is null and usado_em is null;
    if v_qtd <> 1 then
      raise exception 'TESTE FALHOU [T12]: cashback resgatado nao voltou a ficar disponivel apos o cancelamento';
    end if;

    -- T17. Cascata: cancelar a venda que CONCEDEU um credito DEPOIS que ele ja foi gasto noutra venda
    -- (fica intocado, como documentado) e DEPOIS cancelar a venda que o CONSUMIU nao pode devolver o
    -- credito pra 'disponivel' -- a venda de origem dele tambem ja esta cancelada, entao vira
    -- 'cancelado' direto (achado no code-review, 2026-10-21: sem este ajuste, o cliente conseguia
    -- gastar de novo um cashback cuja venda de origem ja tinha sido desfeita).
    declare
      v_venda_origem_t17 uuid;
      v_venda_consumo_t17 uuid;
      v_lanc_t17 uuid;
    begin
      v_venda_origem_t17 := public.registrar_venda_varejo_com_cashback(
        v_sessao_barbara,
        jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
        jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
        gen_random_uuid(), null, null, null, null, 0, 0, v_cliente,
        null, 15.00, current_date + 30
      );
      select id into v_lanc_t17 from public.cashback_lancamentos where venda_origem_id = v_venda_origem_t17 and valor = 15.00;

      v_venda_consumo_t17 := public.registrar_venda_varejo_com_cashback(
        v_sessao_barbara,
        jsonb_build_array(jsonb_build_object('variacao_id', v_var, 'quantidade', 1)),
        jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 85.00)),
        gen_random_uuid(), null, null, null, null, 15.00, 0, v_cliente,
        v_lanc_t17, null, null
      );

      -- Cancela a venda de ORIGEM primeiro -- o credito ja esta 'usado' (preso na venda de consumo),
      -- entao fica como esta (comportamento ja documentado/testado).
      v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_venda_origem_t17);
      perform public.cancelar_venda_varejo_com_cashback(v_venda_origem_t17, 'ensaio cascata origem', (v_json ->> 'autorizacao_id')::uuid);
      select count(*) into v_qtd from public.cashback_lancamentos where id = v_lanc_t17 and situacao = 'usado' and usado_na_venda_id = v_venda_consumo_t17;
      if v_qtd <> 1 then
        raise exception 'TESTE FALHOU [T17]: cashback ja usado nao deveria ter sido tocado ao cancelar a venda de origem';
      end if;

      -- Agora cancela a venda que CONSUMIU -- o credito tem que virar 'cancelado' (sua origem tambem
      -- esta cancelada), NUNCA 'disponivel'.
      v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', v_venda_consumo_t17);
      perform public.cancelar_venda_varejo_com_cashback(v_venda_consumo_t17, 'ensaio cascata consumo', (v_json ->> 'autorizacao_id')::uuid);
      select count(*) into v_qtd from public.cashback_lancamentos where id = v_lanc_t17 and situacao = 'cancelado';
      if v_qtd <> 1 then
        raise exception 'TESTE FALHOU [T17]: cashback com origem cancelada deveria ter virado cancelado, nao disponivel, ao cancelar a venda de consumo';
      end if;
    end;

    execute 'reset role';
  end;

  -- T13. RLS isola por operacao, nao so por papel (achado no code-review, 2026-10-21):
  -- meu_papel() e GLOBAL no profile (nao por operacao) -- Barbara e vendedora e esta ligada tanto a
  -- ATACADO quanto a VAREJO. No contexto ATACADO, ela nao pode ver nem inserir cashback do VAREJO
  -- (v_lanc aqui e o cashback de 5.00 do T4, da operacao VAREJO).
  declare
    v_atacado uuid;
    v_qtd int;
  begin
    select id into v_atacado from public.operacoes where codigo = 'ATACADO';
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_atacado))::text, true);
    execute 'set local role authenticated';

    select count(*) into v_qtd from public.cashback_lancamentos where id = v_lanc;
    if v_qtd <> 0 then
      raise exception 'TESTE FALHOU [T13]: RLS deixou ver cashback do Varejo no contexto Atacado (% linha(s))', v_qtd;
    end if;

    -- operacao_id = v_varejo (nao v_atacado) de proposito: v_venda1 e do VAREJO, entao a trigger
    -- (que exige operacao_id = o da venda de origem) deixaria passar -- quem tem que bloquear aqui e
    -- a RLS (operacao_atual() = ATACADO no contexto da Barbara agora, diferente do v_varejo gravado).
    begin
      insert into public.cashback_lancamentos (cliente_id, venda_origem_id, operacao_id, valor, vencimento)
      values (v_cliente, v_venda1, v_varejo, 99.00, current_date + 30);
      raise exception 'TESTE FALHOU [T13]: RLS deixou inserir cashback no contexto Atacado';
    exception
      when others then
        if sqlerrm !~ 'row-level security policy' then raise; end if;
    end;

    execute 'reset role';
  end;

  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T17 (conceder exige vencimento futuro, resgatar desconta e marca usado, resgate duplo bloqueado, cashback preso ao dono, insert/update direto bloqueado pelas triggers, wrapper concede junto com a venda, wrapper e atomico quando o resgate falha, retry idempotente nao duplica nem falha, cancelamento reconcilia cashback concedido e resgatado, RLS isola por operacao, resgate direto exige desconto correspondente, update direto nao revive cashback usado, desconto acumulado bloqueia resgate duplo contra a mesma venda, cascata de cancelamentos nao ressuscita credito com origem cancelada).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.cancelar_venda_varejo_com_cashback(uuid, text, uuid);
  drop function if exists public.registrar_venda_varejo_com_cashback(
    uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date
  );
  drop function if exists public.resgatar_cashback(uuid, uuid);
  drop function if exists public.cashback_resgatado_na_venda(uuid, uuid);
  drop function if exists public.conceder_cashback(uuid, numeric, date);
  drop table if exists public.cashback_lancamentos;
  drop function if exists public.validar_cashback_lancamento();
  drop function if exists public.validar_transicao_cashback_lancamento();
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if to_regclass('public.cashback_lancamentos') is not null
     or to_regprocedure('public.conceder_cashback(uuid, numeric, date)') is not null
     or to_regprocedure('public.cashback_resgatado_na_venda(uuid, uuid)') is not null
     or to_regprocedure('public.resgatar_cashback(uuid, uuid)') is not null
     or to_regprocedure('public.validar_cashback_lancamento()') is not null
     or to_regprocedure('public.validar_transicao_cashback_lancamento()') is not null
     or to_regprocedure('public.registrar_venda_varejo_com_cashback(uuid, jsonb, jsonb, uuid, text, text, uuid, uuid, numeric, numeric, uuid, uuid, numeric, date)') is not null
     or to_regprocedure('public.cancelar_venda_varejo_com_cashback(uuid, text, uuid)') is not null then
    raise exception 'ENSAIO FALHOU: o rollback nao removeu cashback_lancamentos/conceder_cashback/cashback_resgatado_na_venda/resgatar_cashback/validar_cashback_lancamento/validar_transicao_cashback_lancamento/registrar_venda_varejo_com_cashback/cancelar_venda_varejo_com_cashback por completo.';
  end if;

  raise exception 'ENSAIO OK: cashback no PDV Varejo (tabela cashback_lancamentos com operacao_id e RLS isolada por operacao, sem delete, triggers de validacao de insercao e de transicao de estado (incluindo cascata de cancelamentos), indice unico em venda_origem_id, functions conceder_cashback/resgatar_cashback com checagem de desconto ACUMULADO correspondente e os wrappers atomicos registrar_venda_varejo_com_cashback/cancelar_venda_varejo_com_cashback, com retry idempotente), testado (T1 a T17) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
