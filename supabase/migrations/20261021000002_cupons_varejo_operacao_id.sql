-- Fecha a mesma lacuna de isolamento por operacao que a Fase 3 (cashback) fechou em
-- cashback_lancamentos, agora em cupons_varejo (achado no code-review, 2026-10-21, levantado de novo
-- ao revisar cashback_lancamentos -- ja estava anotado como pendencia nos comentarios daquela
-- migration e em DECISIONS.md, mas nao tinha sido corrigido ainda).
--
-- cupons_varejo (20261020000001) nao tem operacao_id -- a RLS so olha o papel (meu_papel() in
-- ('admin', 'vendedor')), que e GLOBAL no profile, nao por operacao. Um admin/vendedor vinculado a
-- mais de uma operacao (confirmado neste projeto: a vendedora usada nos ensaios de cashback esta
-- ligada a ATACADO e VAREJO ao mesmo tempo) consegue ler/editar/desativar cupons do Varejo mesmo
-- estando no contexto Atacado -- a tela em si so busca no contexto certo, mas a tabela, sozinha, nao
-- impede uma chamada direta fora desse contexto.
--
-- Zero linhas reais em cupons_varejo ate agora (confirmado antes de escrever esta migration) --
-- nao precisa de backfill, so adicionar a coluna, marcar as existentes (nenhuma) e travar NOT NULL.
-- Auto-preenchimento via carimbar_operacao() (mesmo trigger usado em vendas/catalogo_produtos/etc)
-- -- o app (src/lib/actions/cupons-varejo.ts) continua inserindo sem informar operacao_id, nada muda
-- no codigo da aplicacao.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo. Remove a trigger, a coluna operacao_id e devolve a policy antiga (sem isolamento por
-- -- operacao) -- cupons cadastrados nesse meio tempo continuam, so perdem o vinculo com a operacao.
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

  alter table public.cupons_varejo add column operacao_id uuid references public.operacoes (id);
  alter table public.cupons_varejo alter column operacao_id set not null;

  create trigger trg_carimbar_operacao
    before insert on public.cupons_varejo
    for each row execute function public.carimbar_operacao();

  drop policy if exists "admin e vendedor gerenciam cupons_varejo" on public.cupons_varejo;
  create policy "admin e vendedor gerenciam cupons_varejo da propria operacao"
    on public.cupons_varejo for all
    using (public.meu_papel() in ('admin', 'vendedor') and operacao_id = public.operacao_atual())
    with check (public.meu_papel() in ('admin', 'vendedor') and operacao_id = public.operacao_atual());
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cupons_varejo' and column_name = 'operacao_id' and is_nullable = 'NO') then
    raise exception 'FALHA: cupons_varejo.operacao_id nao existe ou aceita null';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_carimbar_operacao' and tgrelid = 'public.cupons_varejo'::regclass and not tgisinternal) then
    raise exception 'FALHA: trigger trg_carimbar_operacao em cupons_varejo nao existe';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cupons_varejo' and policyname = 'admin e vendedor gerenciam cupons_varejo') then
    raise exception 'FALHA: policy antiga (sem isolamento por operacao) ainda existe';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cupons_varejo' and policyname = 'admin e vendedor gerenciam cupons_varejo da propria operacao') then
    raise exception 'FALHA: policy nova (com isolamento por operacao) nao existe';
  end if;

  raise notice 'VERIFICACAO OK: cupons_varejo.operacao_id, trigger de auto-preenchimento e policy isolada por operacao no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_atacado uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_cupom uuid;
  v_qtd int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_atacado from public.operacoes where codigo = 'ATACADO';

  -- T1. Insert no contexto VAREJO continua funcionando sem informar operacao_id (auto-preenchido) --
  -- o app nunca precisou mudar.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  insert into public.cupons_varejo (codigo, tipo, valor) values ('ZZ ENSAIO OPERACAO', 'valor', 10.00) returning id into v_cupom;
  select count(*) into v_qtd from public.cupons_varejo where id = v_cupom and operacao_id = v_varejo;
  if v_qtd <> 1 then raise exception 'TESTE FALHOU [T1]: operacao_id nao foi auto-preenchido com a operacao da sessao'; end if;
  execute 'reset role';

  -- T2. Barbara (vendedora ligada a ATACADO e VAREJO ao mesmo tempo) no contexto ATACADO nao enxerga
  -- o cupom do Varejo -- RLS agora isola por operacao, nao so por papel (achado no code-review,
  -- 2026-10-21, mesma classe de lacuna ja fechada em cashback_lancamentos).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_atacado))::text, true);
  execute 'set local role authenticated';
  select count(*) into v_qtd from public.cupons_varejo where id = v_cupom;
  if v_qtd <> 0 then
    raise exception 'TESTE FALHOU [T2]: RLS deixou ver cupom do Varejo no contexto Atacado (% linha(s))', v_qtd;
  end if;
  begin
    update public.cupons_varejo set ativo = false where id = v_cupom;
    raise exception 'TESTE FALHOU [T2]: RLS deixou desativar cupom do Varejo no contexto Atacado';
  exception
    when others then
      if sqlerrm !~ 'row-level security policy' then raise; end if;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T2 (operacao_id auto-preenchido pelo contexto da sessao, RLS isola cupons por operacao).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop policy if exists "admin e vendedor gerenciam cupons_varejo da propria operacao" on public.cupons_varejo;
  create policy "admin e vendedor gerenciam cupons_varejo"
    on public.cupons_varejo for all
    using (public.meu_papel() in ('admin', 'vendedor'))
    with check (public.meu_papel() in ('admin', 'vendedor'));

  drop trigger if exists trg_carimbar_operacao on public.cupons_varejo;
  alter table public.cupons_varejo drop column if exists operacao_id;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cupons_varejo' and column_name = 'operacao_id')
     or exists (select 1 from pg_trigger where tgname = 'trg_carimbar_operacao' and tgrelid = 'public.cupons_varejo'::regclass and not tgisinternal)
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cupons_varejo' and policyname = 'admin e vendedor gerenciam cupons_varejo')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cupons_varejo' and policyname = 'admin e vendedor gerenciam cupons_varejo da propria operacao') then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu cupons_varejo ao estado original.';
  end if;

  raise exception 'ENSAIO OK: cupons_varejo.operacao_id, trigger de auto-preenchimento e RLS isolada por operacao, testado (T1 a T2) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
