-- Fila de impressao ZPL generica, pra documentos que nao sao uma etiqueta de peca (nao tem
-- produto_id/variacao_id pra preencher) -- pedido do usuario, 2026-11-13: "a notinha da divida com o
-- Atacado precisa imprimir na mesma termica (L42 Pro Full) que ja imprime etiqueta, trocando a
-- bobina pra uma continua". `solicitacoes_etiqueta` (print-agent ja sabe mandar ZPL raw pra essa
-- impressora via `lp -d Elgin_L42 -o raw`, ver print-agent/agent.js) exige produto_id/variacao_id
-- NOT NULL -- nao da pra reusar sem inventar um produto falso. Em vez de afrouxar essa tabela (ja
-- usada pelo Modulo Etiquetas em producao, risco desnecessario), esta migration cria uma fila nova,
-- isolada, com o MESMO desenho minimo (id/zpl/status/erro/criado_em/impresso_em) -- quem monta o ZPL
-- continua sendo o app (nunca o print-agent, mesmo principio do Modulo Etiquetas: agente so ENVIA).
--
-- print-agent/agent.js ganha um 3o loop independente (processarPendentesImpressaoZpl), espelhando
-- processarPendentesEtiqueta linha por linha -- reaproveita enviarZplParaImpressora() tal e qual,
-- zero mudanca nela. Um erro nessa fila nova nunca afeta cupom nem etiqueta, e vice-versa (mesmo
-- isolamento que ja existe entre as duas filas atuais).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Derruba a tabela solicitacoes_impressao_zpl -- bloqueado se ja existir alguma linha
-- -- gravada (perderia o historico de impressao real).
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

  create table public.solicitacoes_impressao_zpl (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    zpl text not null,
    status text not null default 'pendente' check (status in ('pendente', 'impresso', 'erro')),
    erro text,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    impresso_em timestamptz
  );

  -- Mesmo indice parcial de solicitacoes_impressao/solicitacoes_etiqueta -- o print-agent roda essa
  -- consulta (status='pendente') a cada ~2s pra sempre; sem o indice, vira full table scan conforme
  -- a fila acumula historico.
  create index solicitacoes_impressao_zpl_pendentes_idx
    on public.solicitacoes_impressao_zpl (criado_em)
    where (status = 'pendente');

  create trigger trg_carimbar_operacao before insert on public.solicitacoes_impressao_zpl
    for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.solicitacoes_impressao_zpl
    for each row execute function public.travar_operacao();

  alter table public.solicitacoes_impressao_zpl enable row level security;

  create policy "escopo de operacao" on public.solicitacoes_impressao_zpl as restrictive for all to public
    using (operacao_id = public.operacao_atual() or public.sou_dono())
    with check (operacao_id = public.operacao_atual() or public.sou_dono());

  -- So admin -- essa fila hoje so nasce de /varejo/financeiro/divida-atacado, pagina ja admin-only;
  -- diferente de solicitacoes_etiqueta (admin+estoque), nao tem motivo pra abrir pra mais papeis.
  create policy "admin cria solicitacao de impressao zpl" on public.solicitacoes_impressao_zpl
    for insert to authenticated with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin le solicitacoes de impressao zpl" on public.solicitacoes_impressao_zpl
    for select to authenticated using (public.meu_papel() = 'admin'::public.papel_usuario);

  revoke all on public.solicitacoes_impressao_zpl from anon, authenticated;
  grant select, insert on public.solicitacoes_impressao_zpl to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'solicitacoes_impressao_zpl'
  ) then
    raise exception 'FALHA: public.solicitacoes_impressao_zpl nao existe';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'solicitacoes_impressao_zpl'
       and policyname = 'admin cria solicitacao de impressao zpl'
  ) then
    raise exception 'FALHA: policy de insert admin nao existe';
  end if;

  raise notice 'VERIFICACAO OK: solicitacoes_impressao_zpl existe, com RLS e policies admin-only.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_admin uuid;
  v_vendedor uuid;
  v_varejo uuid;
  v_id uuid;
  v_falhou_insert_vendedor boolean := false;
  v_linhas_vendedor integer;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  select p.id into v_admin
    from public.usuario_operacoes uo join public.profiles p on p.id = uo.profile_id
   where uo.operacao_id = v_varejo and p.papel = 'admin' and p.ativo
   limit 1;
  select p.id into v_vendedor
    from public.usuario_operacoes uo join public.profiles p on p.id = uo.profile_id
   where uo.operacao_id = v_varejo and p.papel = 'vendedor' and p.ativo
   limit 1;
  if v_admin is null or v_vendedor is null then
    raise exception 'TESTE FALHOU [setup]: precisa de 1 admin e 1 vendedor ativos na operacao VAREJO pra simular.';
  end if;

  -- T1. Admin cria uma solicitacao (zpl de teste) -- nasce 'pendente', com operacao_id carimbado.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  insert into public.solicitacoes_impressao_zpl (zpl) values ('^XA^FO0,0^A0N,20,20^FDteste ensaio^FS^XZ')
  returning id into v_id;

  if (select status from public.solicitacoes_impressao_zpl where id = v_id) <> 'pendente' then
    raise exception 'TESTE FALHOU [T1]: solicitacao nao nasceu pendente';
  end if;
  if (select operacao_id from public.solicitacoes_impressao_zpl where id = v_id) <> v_varejo then
    raise exception 'TESTE FALHOU [T1]: operacao_id nao foi carimbada como VAREJO';
  end if;

  execute 'reset role';

  -- T2. Vendedor (nao-admin) NAO consegue criar solicitacao -- fila e so-admin, diferente de
  -- solicitacoes_etiqueta (admin+estoque).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.solicitacoes_impressao_zpl (zpl) values ('^XA^XZ');
    v_falhou_insert_vendedor := true;
  exception when others then
    null;
  end;
  if v_falhou_insert_vendedor then
    raise exception 'TESTE FALHOU [T2]: vendedor conseguiu criar solicitacao (deveria ser so-admin)';
  end if;

  -- T3. Vendedor tambem nao le a fila (select bloqueado pela mesma policy admin-only).
  select count(*) into v_linhas_vendedor from public.solicitacoes_impressao_zpl;
  if v_linhas_vendedor <> 0 then
    raise exception 'TESTE FALHOU [T3]: vendedor leu % linha(s) da fila (deveria ser 0)', v_linhas_vendedor;
  end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 (admin cria, nasce pendente, operacao carimbada), T2 (vendedor nao cria), T3 (vendedor nao le).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  if current_setting('app.modo_migration', true) = 'desfazer'
     and exists (select 1 from public.solicitacoes_impressao_zpl limit 1) then
    raise exception 'DESFAZER BLOQUEADO: ja existe solicitacao de impressao gravada -- desfazer perderia esse historico. Mantenha a feature em vez de reverter.';
  end if;

  drop table if exists public.solicitacoes_impressao_zpl;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'solicitacoes_impressao_zpl'
  ) then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: solicitacoes_impressao_zpl criada, testada (T1 a T3) e desfeita -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
