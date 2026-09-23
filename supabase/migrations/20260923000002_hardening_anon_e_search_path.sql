-- Hardening de seguranca (achado pelos advisors do Supabase, nao pelo modulo de varejo): fecha duas
-- brechas em codigo LEGADO do atacado (anterior a esta sessao) sem mudar nenhum comportamento pra
-- quem esta logado.
--
-- O QUE FAZ (uma transacao so):
--   1. REVOGA execute de 'anon' em 26 functions SECURITY DEFINER que so deveriam rodar logado
--      (criar_pedido, extornar_pedido, aprovar_abatimento etc.). Elas ja sao protegidas por
--      assert_papel()/auth.uid() por dentro, mas o Postgres deixava a chamada chegar ate la mesmo
--      sem sessao -- fecha essa camada extra. Confirmado antes desta migration: nenhum script externo
--      (gmax-agent usa SERVICE_ROLE_KEY; print-agent e os scripts de migracao-dados nunca chamam
--      /rpc/, so tabela direto) depende de 'anon' conseguir chamar RPC.
--   2. FIXA search_path em 14 functions (principalmente gatilhos: carimbar_operacao, travar_operacao,
--      bloquear_alteracao_registro etc.) que nao tinham -- pratica recomendada do Postgres contra
--      sequestro de search_path. Nenhuma delas e SECURITY DEFINER (risco ja era baixo), e a mudanca
--      e so de configuracao (ALTER FUNCTION ... SET search_path), o corpo da function nao muda.
--
-- Nao mexe nas 8 views "SECURITY DEFINER" nem nos achados de performance (FK sem indice, RLS nao
-- otimizada) -- confirmado que as views sao propositais (e assim que a vendedora ve so a propria
-- sessao sem acesso direto a tabela) e o resto e debito de performance pre-existente, sem urgencia.
--
-- COMO RODAR: igual as migrations anteriores ('ensaio' -> 'ENSAIO OK' -> 'aplicar'; rollback: 'desfazer').
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo
-- -- inteiro de novo (nao e um script separado: o bloco DO $down$ mais abaixo devolve o GRANT a
-- -- anon e reseta o search_path, testado pelo proprio modo 'ensaio' antes de chegar aqui):
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

-- Fingerprint inclui ACL (grants) e config (search_path) das functions, alem do corpo -- essa
-- migration so muda permissao/config, entao o hash de corpo (prosrc) sozinho nao pegaria a diferenca.
-- ACL ordenada antes de virar texto: revoke+grant nao preserva a ordem original dentro do array
-- (mesmo conjunto de permissoes, ordem do array pode mudar), entao compara ordenado pra nao dar
-- falso positivo de diferenca.
create temp table _fp_antes on commit drop as
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' ||
         coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') || ' ' ||
         coalesce(array_to_string(p.proconfig, ','), '') as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  -- 1. Revoga execute de anon nas 26 functions legadas -----------------------------------------------
  -- 4 delas (marcadas abaixo) ainda tinham grant pra PUBLIC (o "=X" no ACL, default do Postgres na
  -- criacao, nunca revogado) -- anon herda de PUBLIC mesmo depois de revogado dele especificamente,
  -- entao essas precisam do revoke duplo.
  revoke execute on function public.aprovar_abatimento(uuid, numeric, text) from anon;
  revoke execute on function public.aprovar_reprovar_garantia(uuid, boolean, text) from anon;
  revoke execute on function public.assert_papel(papel_usuario[]) from anon;
  revoke execute on function public.auditar_alteracao_preco() from anon, public; -- tinha grant pra PUBLIC
  revoke execute on function public.conceder_permissao(uuid, permissao_especial) from anon;
  revoke execute on function public.converter_cliente_em_crediario(uuid, numeric, text) from anon;
  revoke execute on function public.criar_expedicao(uuid, text, text, text, text, numeric, boolean, text) from anon;
  revoke execute on function public.criar_pedido(uuid, forma_pagamento, status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb) from anon;
  revoke execute on function public.criar_venda_evento(jsonb, text, numeric, integer, uuid, text, text, text) from anon;
  revoke execute on function public.devolver_produto_evento(uuid, integer) from anon;
  revoke execute on function public.extornar_pedido(uuid) from anon;
  revoke execute on function public.extornar_venda_evento(uuid) from anon;
  revoke execute on function public.handle_novo_usuario() from anon, public; -- tinha grant pra PUBLIC
  revoke execute on function public.importar_pedidos_gmax(uuid) from anon;
  revoke execute on function public.importar_produto_evento(uuid, integer, numeric) from anon;
  revoke execute on function public.informar_cotacao(text, numeric, date) from anon;
  revoke execute on function public.lancar_crediario(uuid, uuid, numeric, date) from anon;
  revoke execute on function public.meu_papel() from anon, public; -- tinha grant pra PUBLIC
  revoke execute on function public.operacao_atual() from anon, public; -- tinha grant pra PUBLIC
  revoke execute on function public.pedido_tem_registro_financeiro(uuid) from anon;
  revoke execute on function public.receber_crediario(uuid, text) from anon;
  revoke execute on function public.registrar_acao_funcionario(uuid, text, jsonb, jsonb) from anon;
  revoke execute on function public.registrar_funcionario_criado(uuid, papel_usuario, text) from anon;
  revoke execute on function public.registrar_visualizacao_ficha_cliente(uuid) from anon;
  revoke execute on function public.reprovar_abatimento(uuid, text) from anon;
  revoke execute on function public.revogar_permissao(uuid, permissao_especial) from anon;

  -- 2. Fixa search_path nas 14 functions sem configuracao (na maioria, gatilhos) -----------------------
  alter function public.set_atualizado_em() set search_path = public;
  alter function public.cliente_excluido_importacao_gmax(text) set search_path = public;
  alter function public.definir_codigo_interno_produto() set search_path = public;
  alter function public.definir_codigo_produto_evento() set search_path = public;
  alter function public.carimbar_operacao() set search_path = public;
  alter function public.travar_operacao() set search_path = public;
  alter function public.carimbar_operacao_auditoria() set search_path = public;
  alter function public.arredondar_moeda(numeric) set search_path = public;
  alter function public.validar_vigencia_multiplicador() set search_path = public;
  alter function public.exigir_variacao_no_produto() set search_path = public;
  alter function public.exigir_variacao_restante() set search_path = public;
  alter function public.bloquear_alteracao_movimento() set search_path = public;
  alter function public.carimbar_ip_auditoria() set search_path = public;
  alter function public.bloquear_alteracao_registro() set search_path = public;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select count(*) into v_n from (values
    ('aprovar_abatimento(uuid, numeric, text)'), ('aprovar_reprovar_garantia(uuid, boolean, text)'),
    ('assert_papel(papel_usuario[])'), ('auditar_alteracao_preco()'),
    ('conceder_permissao(uuid, permissao_especial)'), ('converter_cliente_em_crediario(uuid, numeric, text)'),
    ('criar_expedicao(uuid, text, text, text, text, numeric, boolean, text)'),
    ('criar_pedido(uuid, forma_pagamento, status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb)'),
    ('criar_venda_evento(jsonb, text, numeric, integer, uuid, text, text, text)'), ('devolver_produto_evento(uuid, integer)'),
    ('extornar_pedido(uuid)'), ('extornar_venda_evento(uuid)'), ('handle_novo_usuario()'),
    ('importar_pedidos_gmax(uuid)'), ('importar_produto_evento(uuid, integer, numeric)'),
    ('informar_cotacao(text, numeric, date)'), ('lancar_crediario(uuid, uuid, numeric, date)'),
    ('meu_papel()'), ('operacao_atual()'), ('pedido_tem_registro_financeiro(uuid)'),
    ('receber_crediario(uuid, text)'), ('registrar_acao_funcionario(uuid, text, jsonb, jsonb)'),
    ('registrar_funcionario_criado(uuid, papel_usuario, text)'), ('registrar_visualizacao_ficha_cliente(uuid)'),
    ('reprovar_abatimento(uuid, text)'), ('revogar_permissao(uuid, permissao_especial)')
  ) as f(assinatura)
  where has_function_privilege('anon', ('public.' || f.assinatura)::regprocedure, 'EXECUTE');
  if v_n <> 0 then raise exception 'FALHA: % function(s) ainda executaveis por anon', v_n; end if;

  select count(*) into v_n from (values
    ('set_atualizado_em()'), ('cliente_excluido_importacao_gmax(text)'), ('definir_codigo_interno_produto()'),
    ('definir_codigo_produto_evento()'), ('carimbar_operacao()'), ('travar_operacao()'),
    ('carimbar_operacao_auditoria()'), ('arredondar_moeda(numeric)'), ('validar_vigencia_multiplicador()'),
    ('exigir_variacao_no_produto()'), ('exigir_variacao_restante()'), ('bloquear_alteracao_movimento()'),
    ('carimbar_ip_auditoria()'), ('bloquear_alteracao_registro()')
  ) as f(assinatura)
  join pg_proc p on p.oid = ('public.' || f.assinatura)::regprocedure
  where p.proconfig is null or not (array_to_string(p.proconfig, ',') like '%search_path=public%');
  if v_n <> 0 then raise exception 'FALHA: % function(s) ainda sem search_path fixado', v_n; end if;

  raise notice 'VERIFICACAO OK: anon sem execute nas 26 functions, search_path fixado nas 14.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  -- T1. Sem sessao nenhuma (papel anon de verdade): operacao_atual() e meu_papel() sao negados
  execute 'set local role anon';
  v_ok := false;
  begin
    perform public.operacao_atual();
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: anon ainda executa operacao_atual()'; end if;
  v_ok := false;
  begin
    perform public.meu_papel();
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: anon ainda executa meu_papel()'; end if;
  v_ok := false;
  begin
    perform public.informar_cotacao('Ouro', 350.00, current_date);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: anon ainda executa informar_cotacao()'; end if;
  execute 'reset role';

  -- T2. Logado (Lucas, admin, contexto ATACADO): as mesmas functions continuam funcionando normal
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.operacao_atual() is null then raise exception 'TESTE FALHOU [T2]: operacao_atual() parou de funcionar pra quem esta logado'; end if;
  if public.meu_papel() is distinct from 'admin'::papel_usuario then raise exception 'TESTE FALHOU [T2]: meu_papel() parou de funcionar pra quem esta logado'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- T3. arredondar_moeda continua arredondando igual (search_path novo nao mudou o comportamento)
  if public.arredondar_moeda(10.005) <> 10.01 then
    raise exception 'TESTE FALHOU [T3]: arredondar_moeda mudou de comportamento depois do search_path';
  end if;

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T3 (anon barrado, authenticated intacto, arredondamento inalterado).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  grant execute on function public.aprovar_abatimento(uuid, numeric, text) to anon;
  grant execute on function public.aprovar_reprovar_garantia(uuid, boolean, text) to anon;
  grant execute on function public.assert_papel(papel_usuario[]) to anon;
  grant execute on function public.auditar_alteracao_preco() to anon, public;
  grant execute on function public.conceder_permissao(uuid, permissao_especial) to anon;
  grant execute on function public.converter_cliente_em_crediario(uuid, numeric, text) to anon;
  grant execute on function public.criar_expedicao(uuid, text, text, text, text, numeric, boolean, text) to anon;
  grant execute on function public.criar_pedido(uuid, forma_pagamento, status_pedido, jsonb, numeric, numeric, numeric, numeric, jsonb, uuid, jsonb, text, jsonb) to anon;
  grant execute on function public.criar_venda_evento(jsonb, text, numeric, integer, uuid, text, text, text) to anon;
  grant execute on function public.devolver_produto_evento(uuid, integer) to anon;
  grant execute on function public.extornar_pedido(uuid) to anon;
  grant execute on function public.extornar_venda_evento(uuid) to anon;
  grant execute on function public.handle_novo_usuario() to anon, public;
  grant execute on function public.importar_pedidos_gmax(uuid) to anon;
  grant execute on function public.importar_produto_evento(uuid, integer, numeric) to anon;
  grant execute on function public.informar_cotacao(text, numeric, date) to anon;
  grant execute on function public.lancar_crediario(uuid, uuid, numeric, date) to anon;
  grant execute on function public.meu_papel() to anon, public;
  grant execute on function public.operacao_atual() to anon, public;
  grant execute on function public.pedido_tem_registro_financeiro(uuid) to anon;
  grant execute on function public.receber_crediario(uuid, text) to anon;
  grant execute on function public.registrar_acao_funcionario(uuid, text, jsonb, jsonb) to anon;
  grant execute on function public.registrar_funcionario_criado(uuid, papel_usuario, text) to anon;
  grant execute on function public.registrar_visualizacao_ficha_cliente(uuid) to anon;
  grant execute on function public.reprovar_abatimento(uuid, text) to anon;
  grant execute on function public.revogar_permissao(uuid, permissao_especial) to anon;

  alter function public.set_atualizado_em() reset search_path;
  alter function public.cliente_excluido_importacao_gmax(text) reset search_path;
  alter function public.definir_codigo_interno_produto() reset search_path;
  alter function public.definir_codigo_produto_evento() reset search_path;
  alter function public.carimbar_operacao() reset search_path;
  alter function public.travar_operacao() reset search_path;
  alter function public.carimbar_operacao_auditoria() reset search_path;
  alter function public.arredondar_moeda(numeric) reset search_path;
  alter function public.validar_vigencia_multiplicador() reset search_path;
  alter function public.exigir_variacao_no_produto() reset search_path;
  alter function public.exigir_variacao_restante() reset search_path;
  alter function public.bloquear_alteracao_movimento() reset search_path;
  alter function public.carimbar_ip_auditoria() reset search_path;
  alter function public.bloquear_alteracao_registro() reset search_path;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_dif text;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  create temp table _fp_depois on commit drop as
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' ||
           coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') || ' ' ||
           coalesce(array_to_string(p.proconfig, ','), '') as item
      from pg_proc p where p.pronamespace = 'public'::regnamespace;

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu as permissoes/config ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: 26 revokes de anon + 14 search_path aplicados, verificados, testados (T1 a T3) e desfeitos identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
