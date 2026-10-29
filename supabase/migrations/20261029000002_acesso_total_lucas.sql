-- Acesso total pro login do Lucas -- pedido do usuario, 2026-10-29: "eu lucas no meu login eu
-- posso fazer o que eu quiser a qualquer momento". Tres frentes, todas amarradas ao id da conta
-- dele (nao ao papel "admin" em geral -- escolha explicita do usuario, pra nao se estender sozinho
-- a um futuro segundo admin):
--
-- 1. PIN de supervisor: a function `autorizar_acao` recusava "autoautorizacao" (o mesmo usuario
--    nao pode aprovar a propria acao sensivel) sem excecao -- certo pra vendedor/supervisor
--    normais, mas trava o proprio dono. Agora so bloqueia quando NAO for o dono.
-- 2. Rotas/papel: `decidirAcesso` (src/lib/autorizacao/rotas.ts) ganha um bypass total quando
--    `contexto.dono` vier true (continua negando rota sem declaracao -- isso nao e permissao, e a
--    pagina simplesmente nao existir).
-- 3. Trava de operacao (RLS): as politicas RESTRICTIVE "escopo de operacao" (identicas em varias
--    tabelas: `operacao_id = operacao_atual()`) ganham "OR public.sou_dono()". Sem isso o dono
--    continuaria preso ao contexto de operacao selecionado no topo pra ver/editar dado de qualquer
--    modulo.
--
-- Nova function `public.sou_dono()`: so retorna true pro id fixo do Lucas (perfil ja confirmado
-- hoje: 5140c5d4-1cd9-4538-84c3-623b8266c4b2, lucasptrolesi@gmail.com, unico admin ativo agora).
-- Hardcoded de proposito -- e exatamente o que foi pedido ("so o meu login", nao "qualquer admin").
--
-- Limpeza de carona: `autorizar_acao` existia em DUAS sobrecargas (`(text,uuid,text,uuid)` e
-- `(uuid,text,text,uuid)`) -- resto de quando a ordem dos parametros foi trocada numa migration
-- anterior sem DROP (mesma licao ja documentada no cabecalho de 20261028000001/2). A sobrecarga
-- antiga ainda tinha EXECUTE liberado pra `anon`. Esta migration derruba a sobrecarga antiga e
-- mantem so a que o app realmente chama hoje.
--
-- NAO MUDA: `transferencia_itens` nao precisa de ALTER POLICY proprio -- a policy dela e so um
-- EXISTS contra `transferencias`, que roda sob a mesma RLS (nao e security definer) -- ao liberar
-- `transferencias` pro dono, o EXISTS ja enxerga a linha e cascata sozinho.
--
-- NAO MUDA (por enquanto): o bypass de PIN em `autorizar_acao` ainda exige uma linha em
-- `supervisores` pro dono NA OPERACAO EM QUESTAO (ele ja tem uma no Varejo). As acoes privilegiadas
-- (desconto_abaixo_piso/cancelamento_venda/estorno_pagamento/estoque_negativo) hoje so existem no
-- PDV Varejo -- se um dia aparecerem em outro modulo, o dono precisa de supervisor la tambem.
--
-- COMO RODAR: o Editor do Dashboard tem um pre-processador que quebra migration de function grande
-- (ver scripts/rodar-sql.mjs) -- essa aqui mexe em MUITAS policies, rode direto:
--   DATABASE_URL="postgresql://...pooler.supabase.com:5432/postgres" node scripts/rodar-sql.mjs supabase/migrations/20261029000002_acesso_total_lucas.sql
-- 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Nao mexe em dado nenhum, so em regra de acesso. Unica assimetria proposital: o
-- -- desfazer NAO restaura a sobrecarga antiga/duplicada de `autorizar_acao` (era um bug, nao uma
-- -- feature) -- volta pra UMA function so, sem o bypass de autoautorizacao.
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
declare
  v_tabela text;
  v_tabelas text[] := array[
    'abatimentos','aberturas_caixa_evento','autorizacoes_pontuais','caixa_movimentos','caixa_sessoes',
    'caixas','catalogo_produtos','catalogo_variacoes','clientes','comissoes_lancamentos',
    'condicoes_pagamento','contas_pagar','contas_receber','crediario_lancamentos','cupons_evento',
    'depositos','estoque_movimentos','etiqueta_impressoes','etiqueta_modelos','expedicoes',
    'faixas_parcelamento','fechamentos_caixa_evento','fornecedores','garantias',
    'movimentacoes_estoque_evento','movimentos_caixa_evento','movimentos_estoque','notas_fiscais',
    'pedido_itens','pedido_pagamentos_mistos','pedidos','permissoes_usuario','produto_ia_correcoes',
    'produto_imagens','produtos','produtos_evento','solicitacoes_etiqueta','solicitacoes_impressao',
    'supervisores','varejo_config','varejo_dividas_atacado','varejo_equipe','varejo_gastos',
    'varejo_investimento_inicial','varejo_movimentos_caixa','varejo_vendas_manuais','venda_itens',
    'venda_pagamentos','vendas','vendas_evento','vendas_evento_itens','vendedores'
  ];
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  -- 1. sou_dono(): id fixo do Lucas, nao depende de papel nem de tabela nenhuma.
  create or replace function public.sou_dono()
  returns boolean
  language sql
  stable
  set search_path = 'public'
  as $$
    select auth.uid() = '5140c5d4-1cd9-4538-84c3-623b8266c4b2'::uuid;
  $$;
  grant execute on function public.sou_dono() to authenticated;
  revoke all on function public.sou_dono() from anon, public;

  -- 2. autorizar_acao: derruba a sobrecarga antiga/duplicada, mantem so a assinatura que o app usa
  --    (src/lib/actions/varejo.ts chama por nome -- so uma pode existir, senao PostgREST ambiguo).
  drop function if exists public.autorizar_acao(text, uuid, text, uuid);

  create or replace function public.autorizar_acao(p_supervisor_id uuid, p_pin text, p_acao text, p_alvo_id uuid default null::uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = 'public'
  as $$
    declare
      v_op uuid := public.operacao_atual();
      v_sv public.supervisores%rowtype;
      v_id uuid;
    begin
      perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
      if v_op is null then
        raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
      end if;
      if p_acao not in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo') then
        raise exception 'Acao nao suportada';
      end if;
      if p_supervisor_id = auth.uid() and not public.sou_dono() then
        return jsonb_build_object('ok', false, 'motivo', 'auto_autorizacao');
      end if;
      select * into v_sv from public.supervisores
       where profile_id = p_supervisor_id and operacao_id = v_op and ativo for update;
      if not found then
        return jsonb_build_object('ok', false, 'motivo', 'supervisor_invalido');
      end if;
      if v_sv.bloqueado_ate is not null and v_sv.bloqueado_ate > now() then
        return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
      end if;
      if p_pin is null or v_sv.pin_hash <> extensions.crypt(p_pin, v_sv.pin_hash) then
        update public.supervisores
           set tentativas_falhas = tentativas_falhas + 1,
               bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes' else bloqueado_ate end,
               atualizado_em = now()
         where profile_id = p_supervisor_id and operacao_id = v_op;
        perform public.registrar_auditoria('supervisores', p_supervisor_id, 'pin_supervisor_falhou', null,
          jsonb_build_object('acao', p_acao), null);
        return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
      end if;
      update public.supervisores set tentativas_falhas = 0, bloqueado_ate = null, atualizado_em = now()
       where profile_id = p_supervisor_id and operacao_id = v_op;
      insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
      values (p_acao, p_supervisor_id, auth.uid(), p_alvo_id, now() + interval '5 minutes')
      returning id into v_id;
      perform public.registrar_auditoria('autorizacoes_pontuais', v_id, 'autorizacao_concedida', null,
        jsonb_build_object('acao', p_acao, 'supervisor_id', p_supervisor_id, 'alvo_id', p_alvo_id), null);
      return jsonb_build_object('ok', true, 'autorizacao_id', v_id);
    end
  $$;
  grant execute on function public.autorizar_acao(uuid, text, text, uuid) to authenticated;
  revoke all on function public.autorizar_acao(uuid, text, text, uuid) from anon, public;

  -- 3. contexto_sessao(): mesma assinatura, so acrescenta a chave 'dono' no jsonb.
  create or replace function public.contexto_sessao()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = 'public'
  as $$
    select jsonb_build_object(
      'usuario_id', auth.uid(),
      'papel', (select p.papel from public.profiles p where p.id = auth.uid()),
      'operacao_id', public.operacao_atual(),
      'operacao_codigo', (select o.codigo from public.operacoes o where o.id = public.operacao_atual()),
      'operacoes', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome,
                                                                 'ativa', o.ativo, 'padrao', uo.padrao) order by o.codigo)
                               from public.usuario_operacoes uo
                               join public.operacoes o on o.id = uo.operacao_id
                              where uo.profile_id = auth.uid()), '[]'::jsonb),
      'permissoes', coalesce((select jsonb_agg(pu.permissao order by pu.permissao)
                                from public.permissoes_usuario pu
                               where pu.profile_id = auth.uid() and pu.operacao_id = public.operacao_atual()), '[]'::jsonb),
      'dono', public.sou_dono()
    )
  $$;

  -- 4. pdv_supervisores: hoje exclui sempre o proprio usuario (pra PIN pedir OUTRA pessoa). O dono
  --    passa a aparecer na propria lista (ele vai se autoautorizar com o proprio PIN).
  create or replace view public.pdv_supervisores as
    select sv.profile_id, p.nome
      from public.supervisores sv
      join public.profiles p on p.id = sv.profile_id
     where sv.operacao_id = public.operacao_atual() and sv.ativo and p.ativo
       and (sv.profile_id <> auth.uid() or public.sou_dono());

  -- 5. As 52 tabelas com a policy "escopo de operacao" identica (operacao_id = operacao_atual()).
  foreach v_tabela in array v_tabelas loop
    execute format(
      'alter policy %I on public.%I using (operacao_id = operacao_atual() or public.sou_dono()) with check (operacao_id = operacao_atual() or public.sou_dono())',
      'escopo de operacao', v_tabela
    );
  end loop;

  -- 6. As 4 tabelas/policy com expressao diferente (mesma ideia, "OR sou_dono()" no fim).
  alter policy "escopo de operacao" on public.audit_log
    using (operacao_id is null or operacao_id = operacao_atual() or public.sou_dono())
    with check (operacao_id is null or operacao_id = operacao_atual() or public.sou_dono());

  alter policy "escopo de operacao" on public.empresas
    using (id = (select o.empresa_id from public.operacoes o where o.id = operacao_atual()) or public.sou_dono())
    with check (id = (select o.empresa_id from public.operacoes o where o.id = operacao_atual()) or public.sou_dono());

  alter policy "escopo de operacao" on public.transferencias
    using (operacao_origem_id = operacao_atual() or operacao_destino_id = operacao_atual() or public.sou_dono())
    with check (operacao_origem_id = operacao_atual() or operacao_destino_id = operacao_atual() or public.sou_dono());

  alter policy "escopo de operacao notinhas" on storage.objects
    using (bucket_id <> 'pedidos-notas-fotos' or exists (select 1 from public.operacoes o where o.id = operacao_atual() and o.codigo = 'ATACADO') or public.sou_dono())
    with check (bucket_id <> 'pedidos-notas-fotos' or exists (select 1 from public.operacoes o where o.id = operacao_atual() and o.codigo = 'ATACADO') or public.sou_dono());
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_n int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from pg_proc where proname = 'sou_dono' and pronamespace = 'public'::regnamespace) then
    raise exception 'FALHA: public.sou_dono() nao existe';
  end if;

  select count(*) into v_n from pg_proc where proname = 'autorizar_acao' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'FALHA: autorizar_acao deveria ter 1 sobrecarga so, tem %', v_n;
  end if;

  if (select pg_get_functiondef(oid) from pg_proc where proname = 'contexto_sessao' and pronamespace = 'public'::regnamespace) not like '%''dono''%' then
    raise exception 'FALHA: contexto_sessao() nao ganhou a chave dono';
  end if;

  if (select pg_get_viewdef('public.pdv_supervisores'::regclass, true)) not like '%sou_dono%' then
    raise exception 'FALHA: view pdv_supervisores nao ganhou o bypass do dono';
  end if;

  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.vendas'::regclass and polname = 'escopo de operacao') not like '%sou_dono%' then
    raise exception 'FALHA: policy de vendas nao ganhou sou_dono()';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.empresas'::regclass and polname = 'escopo de operacao') not like '%sou_dono%' then
    raise exception 'FALHA: policy de empresas nao ganhou sou_dono()';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.transferencias'::regclass and polname = 'escopo de operacao') not like '%sou_dono%' then
    raise exception 'FALHA: policy de transferencias nao ganhou sou_dono()';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.audit_log'::regclass and polname = 'escopo de operacao') not like '%sou_dono%' then
    raise exception 'FALHA: policy de audit_log nao ganhou sou_dono()';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'escopo de operacao notinhas') not like '%sou_dono%' then
    raise exception 'FALHA: policy de storage.objects (notinhas) nao ganhou sou_dono()';
  end if;

  raise notice 'VERIFICACAO OK: sou_dono(), autorizar_acao (1 so), contexto_sessao, pdv_supervisores e as policies no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_varejo uuid;
  v_atacado uuid;
  v_vendedor uuid;
  v_vendedor_op uuid;
  v_total_atacado bigint;
  v_n bigint;
  v_resultado jsonb;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select p.id, uo.operacao_id into v_vendedor, v_vendedor_op
    from public.profiles p
    join public.usuario_operacoes uo on uo.profile_id = p.id and uo.padrao
   where p.papel = 'vendedor' limit 1;

  select count(*) into v_total_atacado from public.clientes where operacao_id = v_atacado;

  -- T1. sou_dono(): true so pro Lucas.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  if not public.sou_dono() then
    raise exception 'TESTE FALHOU [T1]: sou_dono() deveria ser true pro Lucas';
  end if;
  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_vendedor_op))::text, true);
    if public.sou_dono() then
      raise exception 'TESTE FALHOU [T1]: sou_dono() deveria ser false pra outro usuario';
    end if;
  end if;

  -- T2. autorizar_acao: dono se autoautoriza com o proprio PIN; vendedor continua barrado.
  execute 'reset role';
  update public.supervisores set pin_hash = extensions.crypt('193847', extensions.gen_salt('bf', 10)),
         tentativas_falhas = 0, bloqueado_ate = null
   where profile_id = v_lucas and operacao_id = v_varejo;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  v_resultado := public.autorizar_acao(p_supervisor_id => v_lucas, p_pin => '193847', p_acao => 'cancelamento_venda');
  if not coalesce((v_resultado->>'ok')::boolean, false) then
    raise exception 'TESTE FALHOU [T2]: dono deveria conseguir se autoautorizar, veio %', v_resultado;
  end if;

  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_vendedor_op))::text, true);
    v_resultado := public.autorizar_acao(p_supervisor_id => v_vendedor, p_pin => '000000', p_acao => 'cancelamento_venda');
    if (v_resultado->>'motivo') is distinct from 'auto_autorizacao' then
      raise exception 'TESTE FALHOU [T2]: vendedor deveria continuar barrado de se autoautorizar, veio %', v_resultado;
    end if;
  end if;

  -- T3. RLS: dono enxerga/edita cliente do Atacado mesmo com contexto VAREJO; vendedor nao.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  select count(*) into v_n from public.clientes where operacao_id = v_atacado;
  if v_n <> v_total_atacado then
    raise exception 'TESTE FALHOU [T3]: dono deveria enxergar os % clientes do Atacado mesmo no contexto Varejo, viu %', v_total_atacado, v_n;
  end if;
  update public.clientes set atualizado_em = now() where operacao_id = v_atacado and id = (select id from public.clientes where operacao_id = v_atacado limit 1);
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'TESTE FALHOU [T3]: dono deveria conseguir atualizar cliente do Atacado a partir do contexto Varejo';
  end if;

  if v_vendedor is not null and v_vendedor_op <> v_atacado then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_vendedor_op))::text, true);
    select count(*) into v_n from public.clientes where operacao_id = v_atacado;
    if v_n <> 0 then
      raise exception 'TESTE FALHOU [T3]: vendedor nao-dono nao deveria enxergar cliente de outra operacao, viu %', v_n;
    end if;
  end if;

  -- T4. pdv_supervisores: dono aparece na propria lista; vendedor continua sem se ver.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  select count(*) into v_n from public.pdv_supervisores where profile_id = v_lucas;
  if v_n <> 1 then
    raise exception 'TESTE FALHOU [T4]: dono deveria aparecer na propria lista de supervisores, veio %', v_n;
  end if;

  -- T5. contexto_sessao(): dono=true so pro Lucas.
  if ((public.contexto_sessao())->>'dono')::boolean is not true then
    raise exception 'TESTE FALHOU [T5]: contexto_sessao() do Lucas deveria trazer dono=true';
  end if;
  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_vendedor_op))::text, true);
    if coalesce(((public.contexto_sessao())->>'dono')::boolean, false) then
      raise exception 'TESTE FALHOU [T5]: contexto_sessao() de outro usuario nao deveria trazer dono=true';
    end if;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T5 (sou_dono, autoautorizacao de PIN, RLS cruzando operacao, pdv_supervisores, contexto_sessao).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_tabela text;
  v_tabelas text[] := array[
    'abatimentos','aberturas_caixa_evento','autorizacoes_pontuais','caixa_movimentos','caixa_sessoes',
    'caixas','catalogo_produtos','catalogo_variacoes','clientes','comissoes_lancamentos',
    'condicoes_pagamento','contas_pagar','contas_receber','crediario_lancamentos','cupons_evento',
    'depositos','estoque_movimentos','etiqueta_impressoes','etiqueta_modelos','expedicoes',
    'faixas_parcelamento','fechamentos_caixa_evento','fornecedores','garantias',
    'movimentacoes_estoque_evento','movimentos_caixa_evento','movimentos_estoque','notas_fiscais',
    'pedido_itens','pedido_pagamentos_mistos','pedidos','permissoes_usuario','produto_ia_correcoes',
    'produto_imagens','produtos','produtos_evento','solicitacoes_etiqueta','solicitacoes_impressao',
    'supervisores','varejo_config','varejo_dividas_atacado','varejo_equipe','varejo_gastos',
    'varejo_investimento_inicial','varejo_movimentos_caixa','varejo_vendas_manuais','venda_itens',
    'venda_pagamentos','vendas','vendas_evento','vendas_evento_itens','vendedores'
  ];
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  foreach v_tabela in array v_tabelas loop
    execute format(
      'alter policy %I on public.%I using (operacao_id = operacao_atual()) with check (operacao_id = operacao_atual())',
      'escopo de operacao', v_tabela
    );
  end loop;

  alter policy "escopo de operacao" on public.audit_log
    using (operacao_id is null or operacao_id = operacao_atual())
    with check (operacao_id is null or operacao_id = operacao_atual());

  alter policy "escopo de operacao" on public.empresas
    using (id = (select o.empresa_id from public.operacoes o where o.id = operacao_atual()))
    with check (id = (select o.empresa_id from public.operacoes o where o.id = operacao_atual()));

  alter policy "escopo de operacao" on public.transferencias
    using (operacao_origem_id = operacao_atual() or operacao_destino_id = operacao_atual())
    with check (operacao_origem_id = operacao_atual() or operacao_destino_id = operacao_atual());

  alter policy "escopo de operacao notinhas" on storage.objects
    using (bucket_id <> 'pedidos-notas-fotos' or exists (select 1 from public.operacoes o where o.id = operacao_atual() and o.codigo = 'ATACADO'))
    with check (bucket_id <> 'pedidos-notas-fotos' or exists (select 1 from public.operacoes o where o.id = operacao_atual() and o.codigo = 'ATACADO'));

  create or replace view public.pdv_supervisores as
    select sv.profile_id, p.nome
      from public.supervisores sv
      join public.profiles p on p.id = sv.profile_id
     where sv.operacao_id = public.operacao_atual() and sv.ativo and p.ativo
       and sv.profile_id <> auth.uid();

  create or replace function public.contexto_sessao()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = 'public'
  as $$
    select jsonb_build_object(
      'usuario_id', auth.uid(),
      'papel', (select p.papel from public.profiles p where p.id = auth.uid()),
      'operacao_id', public.operacao_atual(),
      'operacao_codigo', (select o.codigo from public.operacoes o where o.id = public.operacao_atual()),
      'operacoes', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome,
                                                                 'ativa', o.ativo, 'padrao', uo.padrao) order by o.codigo)
                               from public.usuario_operacoes uo
                               join public.operacoes o on o.id = uo.operacao_id
                              where uo.profile_id = auth.uid()), '[]'::jsonb),
      'permissoes', coalesce((select jsonb_agg(pu.permissao order by pu.permissao)
                                from public.permissoes_usuario pu
                               where pu.profile_id = auth.uid() and pu.operacao_id = public.operacao_atual()), '[]'::jsonb)
    )
  $$;

  -- Nao restaura a sobrecarga antiga/duplicada de autorizar_acao (era bug) -- so tira o bypass de
  -- autoautorizacao da unica function que fica.
  create or replace function public.autorizar_acao(p_supervisor_id uuid, p_pin text, p_acao text, p_alvo_id uuid default null::uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = 'public'
  as $$
    declare
      v_op uuid := public.operacao_atual();
      v_sv public.supervisores%rowtype;
      v_id uuid;
    begin
      perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
      if v_op is null then
        raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
      end if;
      if p_acao not in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento', 'estoque_negativo') then
        raise exception 'Acao nao suportada';
      end if;
      if p_supervisor_id = auth.uid() then
        return jsonb_build_object('ok', false, 'motivo', 'auto_autorizacao');
      end if;
      select * into v_sv from public.supervisores
       where profile_id = p_supervisor_id and operacao_id = v_op and ativo for update;
      if not found then
        return jsonb_build_object('ok', false, 'motivo', 'supervisor_invalido');
      end if;
      if v_sv.bloqueado_ate is not null and v_sv.bloqueado_ate > now() then
        return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
      end if;
      if p_pin is null or v_sv.pin_hash <> extensions.crypt(p_pin, v_sv.pin_hash) then
        update public.supervisores
           set tentativas_falhas = tentativas_falhas + 1,
               bloqueado_ate = case when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes' else bloqueado_ate end,
               atualizado_em = now()
         where profile_id = p_supervisor_id and operacao_id = v_op;
        perform public.registrar_auditoria('supervisores', p_supervisor_id, 'pin_supervisor_falhou', null,
          jsonb_build_object('acao', p_acao), null);
        return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
      end if;
      update public.supervisores set tentativas_falhas = 0, bloqueado_ate = null, atualizado_em = now()
       where profile_id = p_supervisor_id and operacao_id = v_op;
      insert into public.autorizacoes_pontuais (acao, supervisor_id, solicitante_id, alvo_id, expira_em)
      values (p_acao, p_supervisor_id, auth.uid(), p_alvo_id, now() + interval '5 minutes')
      returning id into v_id;
      perform public.registrar_auditoria('autorizacoes_pontuais', v_id, 'autorizacao_concedida', null,
        jsonb_build_object('acao', p_acao, 'supervisor_id', p_supervisor_id, 'alvo_id', p_alvo_id), null);
      return jsonb_build_object('ok', true, 'autorizacao_id', v_id);
    end
  $$;
  grant execute on function public.autorizar_acao(uuid, text, text, uuid) to authenticated;
  revoke all on function public.autorizar_acao(uuid, text, text, uuid) from anon, public;

  drop function if exists public.sou_dono();
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (select 1 from pg_proc where proname = 'sou_dono' and pronamespace = 'public'::regnamespace) then
    raise exception 'ENSAIO FALHOU: sou_dono() ainda existe depois do desfazer.';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where proname = 'contexto_sessao' and pronamespace = 'public'::regnamespace) like '%''dono''%' then
    raise exception 'ENSAIO FALHOU: contexto_sessao() ainda tem a chave dono depois do desfazer.';
  end if;
  if (select pg_get_viewdef('public.pdv_supervisores'::regclass, true)) like '%sou_dono%' then
    raise exception 'ENSAIO FALHOU: pdv_supervisores ainda referencia sou_dono depois do desfazer.';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.vendas'::regclass and polname = 'escopo de operacao') like '%sou_dono%' then
    raise exception 'ENSAIO FALHOU: policy de vendas ainda referencia sou_dono depois do desfazer.';
  end if;
  if (select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'escopo de operacao notinhas') like '%sou_dono%' then
    raise exception 'ENSAIO FALHOU: policy de storage.objects ainda referencia sou_dono depois do desfazer.';
  end if;

  raise exception 'ENSAIO OK: sou_dono, autoautorizacao de PIN, 52+4 policies de RLS e pdv_supervisores testados (T1 a T5) e desfeitos -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
