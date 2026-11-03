-- Edicao da "Meta do dia" do PDV Varejo deixa de ser so-admin -- pedido do usuario, 2026-11-03:
-- "o ajuste de metas, nao peca permissao, qualquer pessoal possa editar".
--
-- Achado investigando o pedido: a edicao JA so aparecia pro admin na tela (prop `podeEditarMetas`),
-- mas o problema era mais profundo -- `varejo_config` so tem UMA policy PERMISSIVE, "admin gerencia
-- varejo_config" (meu_papel() = 'admin'), pra TODOS os comandos. Sem outra policy permissiva, RLS
-- bloqueia SELECT/UPDATE inteiro pra quem nao for admin (regra do Postgres: zero policies permissivas
-- que valham = zero acesso, nao importa o que as restritivas digam). Na pratica isso significa que o
-- vendedor no PDV NUNCA via a meta configurada de verdade -- o painel mostrava os defaults do
-- fallback em JS (500/3000/13000) pra ele, mesmo que o admin tivesse configurado outro valor.
-- `varejo_config` tambem guarda fator_venda_padrao/despesas_variaveis_pct/lucro_desejado_pct/
-- encargos_clt_pct/caixa_inicial -- dado de margem que NUNCA pode chegar ao vendedor (regra do
-- modulo de varejo, documentada em varias migrations/CLAUDE.md). Por isso a solucao nao e abrir a
-- tabela toda: duas functions SECURITY DEFINER novas, sem checagem de papel nenhuma (abertas pra
-- "qualquer pessoa" autenticada, exatamente como pedido), que so leem/escrevem meta_diaria/
-- meta_semanal/meta_mensal da config vigente da operacao atual -- o resto da tabela continua
-- igual, admin-only.
--
-- `public.metas_varejo_atual()`: le as 3 metas da config vigente (RETURNS TABLE, 1 linha).
-- `public.editar_metas_varejo(p_meta_diaria, p_meta_semanal, p_meta_mensal)`: valida > 0 (mesmas
-- regras que a action em TS ja validava) e faz UPDATE so dessas 3 colunas na config vigente.
-- Ambas resolvem a operacao via `operacao_atual()` (mesma function usada em todo o resto do
-- sistema) -- escopam sozinhas, sem precisar que quem chama seja admin ou vendedor especifico.
--
-- `src/lib/actions/varejo-financeiro.ts` (`editarMetasVarejo`) passa a chamar o RPC em vez de
-- fazer select+update direto na tabela (que ja nao funcionaria pra ninguem alem do admin).
-- `/varejo/pdv` (`page.tsx`) passa a ler as metas via `metas_varejo_atual()` em vez do
-- `varejo_config.select("*")` que so admin conseguia de fato ler. `podeEditarMetas` sai da tela
-- (pdv-varejo-view.tsx) -- o lapis de editar aparece pra qualquer um.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Derruba as duas functions -- a tela volta a exigir admin pra editar E pra ver a meta
-- -- real (volta ao bug do fallback em JS pro vendedor, que e o estado anterior a esta migration).
-- --   select set_config('app.modo_migration', 'desfazer', true);


begin;

-- >>> MODO (troque so esta linha): 'ensaio' | 'aplicar' | 'desfazer'
select set_config('app.modo_migration', 'aplicar', true);
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

  create or replace function public.metas_varejo_atual()
  returns table (meta_diaria numeric, meta_semanal numeric, meta_mensal numeric)
  language sql
  stable
  security definer
  set search_path = 'public'
  as $fn1$
    select c.meta_diaria, c.meta_semanal, c.meta_mensal
      from public.varejo_config c
     where c.operacao_id = public.operacao_atual()
       and c.vigente_desde <= current_date
     order by c.vigente_desde desc
     limit 1;
  $fn1$;

  grant execute on function public.metas_varejo_atual() to authenticated;
  revoke all on function public.metas_varejo_atual() from anon, public;

  create or replace function public.editar_metas_varejo(
    p_meta_diaria numeric,
    p_meta_semanal numeric,
    p_meta_mensal numeric
  )
  returns void
  language plpgsql
  security definer
  set search_path = 'public'
  as $fn2$
  declare
    v_id uuid;
  begin
    if p_meta_diaria is null or p_meta_diaria <= 0 then
      raise exception 'Informe a meta diária.';
    end if;
    if p_meta_semanal is null or p_meta_semanal <= 0 then
      raise exception 'Informe a meta semanal.';
    end if;
    if p_meta_mensal is null or p_meta_mensal <= 0 then
      raise exception 'Informe a meta mensal.';
    end if;

    select c.id into v_id
      from public.varejo_config c
     where c.operacao_id = public.operacao_atual()
       and c.vigente_desde <= current_date
     order by c.vigente_desde desc
     limit 1;

    if v_id is null then
      raise exception 'Nenhuma configuração vigente encontrada.';
    end if;

    update public.varejo_config
       set meta_diaria = p_meta_diaria, meta_semanal = p_meta_semanal, meta_mensal = p_meta_mensal
     where id = v_id;
  end;
  $fn2$;

  grant execute on function public.editar_metas_varejo(numeric, numeric, numeric) to authenticated;
  revoke all on function public.editar_metas_varejo(numeric, numeric, numeric) from anon, public;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'metas_varejo_atual' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'FALHA: public.metas_varejo_atual nao existe';
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'editar_metas_varejo' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'FALHA: public.editar_metas_varejo nao existe';
  end if;
  if not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'metas_varejo_atual'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'FALHA: authenticated sem EXECUTE em metas_varejo_atual';
  end if;
  if not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'editar_metas_varejo'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'FALHA: authenticated sem EXECUTE em editar_metas_varejo';
  end if;

  raise notice 'VERIFICACAO OK: as duas functions existem e authenticated tem EXECUTE nelas.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_vendedor uuid;
  v_varejo uuid;
  v_real_diaria numeric;
  v_real_semanal numeric;
  v_real_mensal numeric;
  v_rpc_diaria numeric;
  v_rpc_semanal numeric;
  v_rpc_mensal numeric;
  v_linhas_tabela_direta integer;
  v_falhou_validacao boolean := false;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  -- Vendedor de verdade, membro da operacao VAREJO -- representa "qualquer pessoa" que usa o PDV
  -- (a propria tela /varejo/pdv ja so deixa admin/vendedor entrarem; nao precisa testar outro papel).
  select p.id into v_vendedor
    from public.usuario_operacoes uo
    join public.profiles p on p.id = uo.profile_id
   where uo.operacao_id = v_varejo and p.papel = 'vendedor' and p.ativo
   limit 1;
  if v_vendedor is null then
    raise exception 'TESTE FALHOU [setup]: nenhum vendedor ativo encontrado na operacao VAREJO pra simular.';
  end if;

  -- Valores reais de hoje, lidos como superusuario (ground truth pra comparar com o RPC).
  select c.meta_diaria, c.meta_semanal, c.meta_mensal
    into v_real_diaria, v_real_semanal, v_real_mensal
    from public.varejo_config c
   where c.operacao_id = v_varejo and c.vigente_desde <= current_date
   order by c.vigente_desde desc
   limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. Vendedor (sem ser admin/dono) le a meta real via RPC -- nao o fallback de 500/3000/13000.
  select meta_diaria, meta_semanal, meta_mensal into v_rpc_diaria, v_rpc_semanal, v_rpc_mensal
    from public.metas_varejo_atual();
  if v_rpc_diaria is distinct from v_real_diaria or v_rpc_semanal is distinct from v_real_semanal
     or v_rpc_mensal is distinct from v_real_mensal then
    raise exception 'TESTE FALHOU [T1]: RPC devolveu %/%/%  mas o valor real e %/%/%',
      v_rpc_diaria, v_rpc_semanal, v_rpc_mensal, v_real_diaria, v_real_semanal, v_real_mensal;
  end if;

  -- T2. Vendedor edita as metas sem precisar de PIN/papel nenhum, e o RPC de leitura reflete.
  perform public.editar_metas_varejo(777, 4321, 55555);
  select meta_diaria, meta_semanal, meta_mensal into v_rpc_diaria, v_rpc_semanal, v_rpc_mensal
    from public.metas_varejo_atual();
  if v_rpc_diaria <> 777 or v_rpc_semanal <> 4321 or v_rpc_mensal <> 55555 then
    raise exception 'TESTE FALHOU [T2]: depois de editar_metas_varejo(777,4321,55555), RPC leu %/%/%',
      v_rpc_diaria, v_rpc_semanal, v_rpc_mensal;
  end if;

  -- T3. Mesmo editando as metas, o vendedor continua SEM conseguir ler a tabela toda direto
  -- (fator_venda_padrao e companhia continuam escondidos -- RLS ainda bloqueia o SELECT cru).
  select count(*) into v_linhas_tabela_direta from public.varejo_config;
  if v_linhas_tabela_direta <> 0 then
    raise exception 'TESTE FALHOU [T3]: vendedor conseguiu ler % linha(s) direto de varejo_config (deveria ser 0 -- so o RPC pode expor as metas)',
      v_linhas_tabela_direta;
  end if;

  -- T4. Validacao continua valendo pro vendedor (nao abriu mao de validar, so da checagem de papel).
  begin
    perform public.editar_metas_varejo(0, 100, 100);
    v_falhou_validacao := true;
  exception when others then
    null;
  end;
  if v_falhou_validacao then
    raise exception 'TESTE FALHOU [T4]: editar_metas_varejo(0, ...) deveria ter sido rejeitado.';
  end if;

  execute 'reset role';

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 (le meta real sem ser admin), T2 (edita sem papel/PIN), T3 (tabela cheia continua bloqueada), T4 (validacao > 0 continua valendo).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.editar_metas_varejo(numeric, numeric, numeric);
  drop function if exists public.metas_varejo_atual();
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('metas_varejo_atual', 'editar_metas_varejo')
  ) then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: metas_varejo_atual/editar_metas_varejo testadas (T1 a T4) e desfeitas -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
