-- Conceder/revogar uma operação extra pra um funcionário já cadastrado (pedido do usuário,
-- 2026-10-23: "configure a Hemilly para o varejo também, no app eu não consigo alterar") --
-- achado ao investigar: `/permissoes` não tinha (e nunca teve) nenhum jeito de dar uma SEGUNDA
-- operação pra um funcionário existente. `usuario_operacoes` só ganha uma linha, uma única vez,
-- na hora de `criarFuncionario` (vinculada à operação em que o admin estava no momento do
-- cadastro) -- não era bug de celular, a função simplesmente não existia em lugar nenhum do app.
--
-- Duas functions novas, espelhando o resto de `/permissoes` (conceder_permissao/revogar_permissao,
-- que fazem o mesmo pra `permissoes_usuario` -- essa tabela é a irmã dessas, mesmo padrão de
-- assert_papel(['admin']) + registrar_auditoria):
--
-- `conceder_operacao_funcionario(p_profile_id, p_operacao_id)` -- idempotente (clicar duas vezes
-- não duplica nem dá erro); a PRIMEIRA operação de alguém nasce padrão automaticamente (reproduz
-- o que `criarFuncionario` já fazia), qualquer operação ALÉM da primeira nasce padrao=false (nunca
-- troca o "pouso" de quem já tem uma sem pedir).
--
-- `revogar_operacao_funcionario(p_profile_id, p_operacao_id)` -- duas regras que não existiam
-- antes porque a situação não existia antes (só se concedia, nunca se revogava):
--   1. Nunca pode zerar as operações de alguém -- um funcionário sem nenhuma não enxerga nada em
--      lugar nenhum do app (mesmo risco que o comentário de `criarFuncionario` já descreve pro
--      cadastro). Bloqueado com mensagem clara em vez de deixar a pessoa trancada de fora.
--   2. Se a operação revogada ERA a padrão dele, outra (das que sobraram) é promovida a padrão
--      na mesma transação -- sem isso, `contexto_sessao()` ficaria sem nenhuma linha `padrao=true`
--      pra cair de volta quando o JWT não tiver claim de operação (índice único
--      `usuario_operacoes_padrao_key` já impede DUAS, mas nada impedia ZERO).
--
-- Mesmo padrão de validação de alvo das outras functions de /permissoes: nunca aceita um perfil
-- `admin` como alvo (a tela já filtra `papel <> 'admin'` na listagem, isso é só a segunda camada,
-- igual RLS+function em todo o resto do projeto).
--
-- NÃO muda a tabela nem RLS (já é `admin gerencia usuario_operacoes` desde a Etapa 2) -- só
-- adiciona as 2 functions que faltavam pra essa ação ter um caminho no app.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Remove as 2 functions (nada mais foi criado/alterado nesta migration).
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

  create function public.conceder_operacao_funcionario(p_profile_id uuid, p_operacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $$
  declare
    v_ja_tem boolean;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);

    if exists (select 1 from public.profiles where id = p_profile_id and papel = 'admin') then
      raise exception 'Administradores já têm acesso a todas as operações';
    end if;

    select exists(
      select 1 from public.usuario_operacoes where profile_id = p_profile_id and operacao_id = p_operacao_id
    ) into v_ja_tem;
    if v_ja_tem then
      return; -- idempotente: já tinha, não há nada a fazer
    end if;

    insert into public.usuario_operacoes (profile_id, operacao_id, concedida_por, padrao)
    values (
      p_profile_id, p_operacao_id, auth.uid(),
      not exists (select 1 from public.usuario_operacoes where profile_id = p_profile_id)
    );

    perform public.registrar_auditoria('usuario_operacoes', p_profile_id, 'conceder_operacao', null,
      jsonb_build_object('operacao_id', p_operacao_id));
  end
  $$;

  revoke execute on function public.conceder_operacao_funcionario(uuid, uuid) from public, anon;
  grant execute on function public.conceder_operacao_funcionario(uuid, uuid) to authenticated;

  create function public.revogar_operacao_funcionario(p_profile_id uuid, p_operacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $$
  declare
    v_total int;
    v_era_padrao boolean;
    v_proxima_operacao_id uuid;
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);

    select count(*) into v_total from public.usuario_operacoes where profile_id = p_profile_id;

    select padrao into v_era_padrao
      from public.usuario_operacoes where profile_id = p_profile_id and operacao_id = p_operacao_id;
    if v_era_padrao is null then
      raise exception 'Esse funcionário não tem acesso a essa operação';
    end if;

    if v_total <= 1 then
      raise exception 'Não é possível remover a única operação deste funcionário -- ele ficaria sem acesso a nada no sistema';
    end if;

    delete from public.usuario_operacoes where profile_id = p_profile_id and operacao_id = p_operacao_id;

    if v_era_padrao then
      select operacao_id into v_proxima_operacao_id
        from public.usuario_operacoes where profile_id = p_profile_id limit 1;
      update public.usuario_operacoes set padrao = true
        where profile_id = p_profile_id and operacao_id = v_proxima_operacao_id;
    end if;

    perform public.registrar_auditoria('usuario_operacoes', p_profile_id, 'revogar_operacao',
      jsonb_build_object('operacao_id', p_operacao_id), null);
  end
  $$;

  revoke execute on function public.revogar_operacao_funcionario(uuid, uuid) from public, anon;
  grant execute on function public.revogar_operacao_funcionario(uuid, uuid) to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.conceder_operacao_funcionario(uuid, uuid)') is null then
    raise exception 'FALHA: conceder_operacao_funcionario nao existe';
  end if;
  if to_regprocedure('public.revogar_operacao_funcionario(uuid, uuid)') is null then
    raise exception 'FALHA: revogar_operacao_funcionario nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.conceder_operacao_funcionario(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.revogar_operacao_funcionario(uuid, uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute nas functions novas';
  end if;
  if has_function_privilege('anon', 'public.conceder_operacao_funcionario(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.revogar_operacao_funcionario(uuid, uuid)', 'execute') then
    raise exception 'FALHA: anon com execute nas functions novas';
  end if;

  raise notice 'VERIFICACAO OK: conceder_operacao_funcionario e revogar_operacao_funcionario no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_hemilly uuid := '5bfc1a6c-a7cd-4246-9d17-616d542a40b2';
  v_atacado uuid;
  v_varejo uuid;
  v_n int;
  v_padrao boolean;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Baseline conhecido pro teste (dentro da transacao do ensaio -- nada disso fica gravado de
  -- verdade): Hemilly so com ATACADO, padrao.
  delete from public.usuario_operacoes where profile_id = v_hemilly;
  insert into public.usuario_operacoes (profile_id, operacao_id, concedida_por, padrao)
    values (v_hemilly, v_atacado, v_lucas, true);

  -- T1. Admin concede VAREJO pra Hemilly -> nasce com padrao=false (ATACADO continua sendo o
  -- padrao dela).
  perform public.conceder_operacao_funcionario(v_hemilly, v_varejo);
  select count(*) into v_n from public.usuario_operacoes where profile_id = v_hemilly;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T1]: esperava 2 operacoes apos conceder, achou %', v_n; end if;
  select padrao into v_padrao from public.usuario_operacoes where profile_id = v_hemilly and operacao_id = v_varejo;
  if v_padrao then raise exception 'TESTE FALHOU [T1]: VAREJO deveria nascer padrao=false (ja tinha ATACADO)'; end if;

  -- T2. Conceder a MESMA operacao de novo -> idempotente, nao duplica, nao da erro.
  perform public.conceder_operacao_funcionario(v_hemilly, v_varejo);
  select count(*) into v_n from public.usuario_operacoes where profile_id = v_hemilly;
  if v_n <> 2 then raise exception 'TESTE FALHOU [T2]: conceder de novo duplicou a linha (%)', v_n; end if;

  -- T3. Tentar conceder operacao pra um perfil ADMIN -> bloqueado.
  begin
    perform public.conceder_operacao_funcionario(v_lucas, v_varejo);
    raise exception 'TESTE FALHOU [T3]: conceder operacao pra admin deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'já têm acesso a todas' then raise; end if;
  end;

  -- T4. Revogar a operacao que ERA padrao (ATACADO) -> sucesso, e VAREJO (a que sobrou) e
  -- promovida a padrao automaticamente.
  perform public.revogar_operacao_funcionario(v_hemilly, v_atacado);
  select count(*) into v_n from public.usuario_operacoes where profile_id = v_hemilly;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: esperava 1 operacao apos revogar, achou %', v_n; end if;
  select padrao into v_padrao from public.usuario_operacoes where profile_id = v_hemilly and operacao_id = v_varejo;
  if not coalesce(v_padrao, false) then raise exception 'TESTE FALHOU [T4]: VAREJO deveria ter sido promovida a padrao apos remover a antiga padrao'; end if;

  -- T5. Revogar a UNICA operacao restante -> bloqueado.
  begin
    perform public.revogar_operacao_funcionario(v_hemilly, v_varejo);
    raise exception 'TESTE FALHOU [T5]: revogar a unica operacao deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'única operação' then raise; end if;
  end;

  -- T6. Revogar uma operacao que o funcionario NAO tem (ATACADO, ja revogada no T4) -> bloqueado
  -- com mensagem especifica (nao a mesma do T5).
  begin
    perform public.revogar_operacao_funcionario(v_hemilly, v_atacado);
    raise exception 'TESTE FALHOU [T6]: revogar operacao que o funcionario nao tem deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm !~ 'não tem acesso a essa operação' then raise; end if;
  end;

  -- T7. Nao-admin (a propria Hemilly, vendedor) tentando conceder/revogar -> bloqueado nos dois.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_hemilly, 'role', 'authenticated')::text, true);
  begin
    perform public.conceder_operacao_funcionario(v_hemilly, v_atacado);
    raise exception 'TESTE FALHOU [T7a]: nao-admin conseguiu conceder operacao';
  exception
    when others then
      if sqlerrm !~ 'Sem permissão' then raise; end if;
  end;
  begin
    perform public.revogar_operacao_funcionario(v_hemilly, v_varejo);
    raise exception 'TESTE FALHOU [T7b]: nao-admin conseguiu revogar operacao';
  exception
    when others then
      if sqlerrm !~ 'Sem permissão' then raise; end if;
  end;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T7 (conceder idempotente/so admin, revogar promove novo padrao/bloqueia ultima operacao/bloqueia quem nao tem/so admin).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.conceder_operacao_funcionario(uuid, uuid);
  drop function if exists public.revogar_operacao_funcionario(uuid, uuid);
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if to_regprocedure('public.conceder_operacao_funcionario(uuid, uuid)') is not null
     or to_regprocedure('public.revogar_operacao_funcionario(uuid, uuid)') is not null then
    raise exception 'ENSAIO FALHOU: o rollback nao removeu as functions novas.';
  end if;

  raise exception 'ENSAIO OK: conceder_operacao_funcionario e revogar_operacao_funcionario testados (T1 a T7) e desfeitos -- nada foi gravado de verdade (transacao abortada de proposito, Hemilly continua com o acesso que ela tinha antes de rodar este arquivo).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
