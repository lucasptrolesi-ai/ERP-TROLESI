-- Cupom de desconto no PDV Varejo (pedido do usuário, 2026-10-19/20, Fase 2 de 3 -- cliente, cupom,
-- cashback), espelhando o cupom do PDV Eventos (`cupons_evento`, 20260903000001) quase igual: código,
-- tipo percentual|valor, ativo/inativo, sem limite de uso nem validade -- a mesma decisão de projeto
-- enxuto do original ("parar de aceitar" é só desativar o cupom). Tabela PRÓPRIA (`cupons_varejo`,
-- tipo `tipo_cupom_varejo`) em vez de reaproveitar a do Eventos -- os dois PDVs já são bases de dados
-- isoladas por natureza (operacao_id em todo o resto do Varejo; `cupons_evento` nem tem operacao_id
-- porque o Eventos é a operação inteira) e um nome de cupom do Agroshow não tem nada a ver com um
-- nome de cupom de loja.
--
-- Mesmo espírito "sem ida ao servidor no meio da venda": a lista de cupons carrega inteira na tela
-- (mesmo padrão do catálogo), e o PDV aplica o cupom procurando na lista já em memória
-- (`calcularDescontoCupomVarejo`, client-side). NÃO muda registrar_venda nem adiciona validação nova
-- na hora de fechar a venda -- p_valor_desconto já aceita qualquer valor >= 0 desde sempre
-- (desconto/acréscimo do carrinho, 20260930000001): o cupom só preenche esse mesmo campo calculado,
-- não é uma nova fronteira de segurança (igual ao Eventos).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo. Apaga a tabela cupons_varejo inteira (e o tipo) -- cupons cadastrados seriam perdidos.
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

  create type public.tipo_cupom_varejo as enum ('percentual', 'valor');

  create table public.cupons_varejo (
    id uuid primary key default gen_random_uuid(),
    codigo text not null,
    tipo public.tipo_cupom_varejo not null,
    valor numeric(10, 2) not null check (valor > 0),
    ativo boolean not null default true,
    criado_por uuid references public.profiles (id),
    criado_em timestamptz not null default now(),
    constraint cupons_varejo_percentual_max check (tipo <> 'percentual' or valor <= 100)
  );

  -- Case-insensitive: "trolesi10" e "TROLESI10" sao o mesmo cupom (igual cupons_evento).
  create unique index cupons_varejo_codigo_key on public.cupons_varejo (upper(codigo));

  alter table public.cupons_varejo enable row level security;

  create policy "admin e vendedor gerenciam cupons_varejo"
    on public.cupons_varejo for all
    using (public.meu_papel() in ('admin', 'vendedor'))
    with check (public.meu_papel() in ('admin', 'vendedor'));
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regtype('public.tipo_cupom_varejo') is null then
    raise exception 'FALHA: tipo tipo_cupom_varejo nao existe';
  end if;
  if to_regclass('public.cupons_varejo') is null then
    raise exception 'FALHA: tabela cupons_varejo nao existe';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'cupons_varejo_codigo_key') then
    raise exception 'FALHA: indice unico cupons_varejo_codigo_key nao existe';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'cupons_varejo' and c.relrowsecurity
  ) then
    raise exception 'FALHA: RLS nao esta habilitado em cupons_varejo';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cupons_varejo') then
    raise exception 'FALHA: nenhuma policy em cupons_varejo';
  end if;

  raise notice 'VERIFICACAO OK: tipo, tabela, indice unico e RLS de cupons_varejo no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_cupom uuid;
  v_n int;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. Vendedor/admin consegue cadastrar cupom
  insert into public.cupons_varejo (codigo, tipo, valor) values ('ZZENSAIO10', 'percentual', 10) returning id into v_cupom;
  select count(*) into v_n from public.cupons_varejo where id = v_cupom;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: cupom nao foi cadastrado'; end if;

  -- T2. Codigo e case-insensitive (unique index trava duplicata com case diferente)
  begin
    insert into public.cupons_varejo (codigo, tipo, valor) values ('zzensaio10', 'valor', 5);
    raise exception 'TESTE FALHOU [T2]: cupom com codigo duplicado (case diferente) deveria ter sido rejeitado';
  exception
    when unique_violation then
      null; -- esperado
  end;

  -- T3. Percentual acima de 100 e rejeitado
  begin
    insert into public.cupons_varejo (codigo, tipo, valor) values ('ZZENSAIO200', 'percentual', 200);
    raise exception 'TESTE FALHOU [T3]: percentual acima de 100 deveria ter sido rejeitado';
  exception
    when check_violation then
      null; -- esperado
  end;

  delete from public.cupons_varejo where codigo ilike 'ZZENSAIO%';

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T3 (cadastro, codigo case-insensitive, limite de percentual).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop table if exists public.cupons_varejo;
  drop type if exists public.tipo_cupom_varejo;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if to_regclass('public.cupons_varejo') is not null or to_regtype('public.tipo_cupom_varejo') is not null then
    raise exception 'ENSAIO FALHOU: o rollback nao removeu cupons_varejo/tipo_cupom_varejo por completo.';
  end if;

  raise exception 'ENSAIO OK: cupom de desconto no PDV Varejo (tipo_cupom_varejo, tabela cupons_varejo, indice unico case-insensitive, RLS admin/vendedor), testado (T1 a T3) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
