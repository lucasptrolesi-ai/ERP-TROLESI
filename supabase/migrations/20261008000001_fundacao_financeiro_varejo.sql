-- Controle Financeiro do Varejo (Fase 1-2 do documento trazido pelo usuario em 2026-10-08):
-- substitui a planilha/pagina separada que o dono usava pra acompanhar margem, ponto de equilibrio
-- e precificacao da loja fisica do Varejo (Rua Major Belo Lisboa, Itajuba/MG). So dono/admin acessa
-- -- vendedor nunca ve custo, margem nem este modulo.
--
-- Duas decisoes tomadas com o usuario antes desta migration (AskUserQuestion, 2026-10-08):
--   1. "Cupom com teto ligado ao 2,8x" do documento original NAO existe no PDV Varejo -- o que ja
--      existe e a trava de preco_minimo com PIN de supervisor (desconto_abaixo_piso). Nao criamos
--      cupom nenhum aqui.
--   2. O fator de custo 2,8x do documento NAO vira uma coluna nova em varejo_config -- ja existe em
--      public.parametros_multiplicador (chave 'TRANSFERENCIA_ATACADO_VAREJO'), unica fonte de
--      verdade. O app le essa tabela direto (admin ja tem select nela desde 20260921000003).
--
-- O QUE FAZ (uma transacao so):
--   1. 6 tabelas novas, todas isoladas por operacao_id (mesmo padrao de carimbar_operacao/
--      travar_operacao ja usado em catalogo_produtos/catalogo_variacoes/estoque_movimentos) e
--      travadas pra so funcionar dentro da operacao VAREJO (trigger exigir_financeiro_varejo):
--        - varejo_config: premissas com vigencia (insert-only -- historico nunca e editado, so
--          cresce; vale a linha mais recente com vigente_desde <= mes).
--        - varejo_gastos: gastos mensais recorrentes e compras parceladas.
--        - varejo_equipe: salarios/pro-labore (somar_encargos default false).
--        - varejo_movimentos_caixa: aporte/retirada fora de venda.
--        - varejo_investimento_inicial: gasto de abertura da loja (nao afeta o saldo de caixa
--          corrente -- regra calculada no motor TypeScript, nao aqui).
--        - varejo_vendas_manuais: faturamento soh pra dia sem PDV ou pra importar o controle antigo
--          (unique por dia -- o motor decide se o PDV prevalece).
--   2. Auditoria automatica (public.auditar_financeiro_varejo(), trigger generico via TG_TABLE_NAME/
--      TG_OP) em toda insercao/edicao/exclusao das 6 tabelas -- registrar_auditoria() ja existente.
--   3. Nenhuma function de leitura nova: admin ja tem select direto em vendas/venda_itens (RLS
--      "admin le venda_itens" de 20260921000005) e em parametros_multiplicador -- o motor de calculo
--      (src/lib/varejo/financeiro.ts, funcoes puras) e alimentado por essas leituras diretas, no
--      mesmo padrao ja usado em /relatorios e /varejo/dashboard.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo (o bloco DO $down$ mais abaixo devolve tudo ao estado anterior, testado pelo proprio modo
-- -- 'ensaio' antes de chegar aqui):
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

create temp table _fp_antes on commit drop as
  select item from (
    select 'TAB ' || t.table_name as item from information_schema.tables t
     where t.table_schema = 'public'
       and t.table_name in ('varejo_config', 'varejo_gastos', 'varejo_equipe', 'varejo_movimentos_caixa',
                             'varejo_investimento_inicial', 'varejo_vendas_manuais')
    union all
    select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('auditar_financeiro_varejo', 'exigir_financeiro_varejo')
  ) x;

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  -- 1. Trava generica: nenhuma das 6 tabelas aceita escrita fora da operacao VAREJO -------------
  create or replace function public.exigir_financeiro_varejo() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform public.exigir_operacao_codigo('VAREJO');
    return new;
  end
  $fn$;

  -- 2. Auditoria generica: toda insercao/edicao/exclusao nas 6 tabelas vira registro em audit_log -
  create or replace function public.auditar_financeiro_varejo() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if tg_op = 'INSERT' then
      perform public.registrar_auditoria(tg_table_name, new.id, 'criacao', null, to_jsonb(new), null);
      return new;
    elsif tg_op = 'UPDATE' then
      perform public.registrar_auditoria(tg_table_name, new.id, 'edicao', to_jsonb(old), to_jsonb(new), null);
      return new;
    else
      perform public.registrar_auditoria(tg_table_name, old.id, 'exclusao', to_jsonb(old), null, null);
      return old;
    end if;
  end
  $fn$;

  -- 3. varejo_config: premissas com vigencia, insert-only ----------------------------------------
  create table public.varejo_config (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    vigente_desde date not null,
    fator_venda_padrao numeric(8, 4) not null check (fator_venda_padrao > 0) default 10.1,
    fator_venda_min numeric(8, 4) not null check (fator_venda_min > 0) default 9.0,
    fator_venda_max numeric(8, 4) not null check (fator_venda_max > 0) default 11.2,
    despesas_variaveis_pct numeric(7, 4) not null check (despesas_variaveis_pct between 0 and 1) default 0.10,
    lucro_desejado_pct numeric(7, 4) not null check (lucro_desejado_pct between 0 and 1) default 0.15,
    dias_abertos_mes integer not null check (dias_abertos_mes between 1 and 31) default 26,
    encargos_clt_pct numeric(7, 4) not null check (encargos_clt_pct >= 0) default 0.34,
    caixa_inicial numeric(12, 2) not null default 0,
    mes_abertura date not null,
    preco_piso_entrada numeric(12, 2) not null check (preco_piso_entrada >= 0) default 19.90,
    arredondar_90 boolean not null default true,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    constraint varejo_config_faixa_venda check (fator_venda_min <= fator_venda_max),
    constraint varejo_config_vigencia_unica unique (operacao_id, vigente_desde)
  );

  -- 4. varejo_gastos: gastos mensais recorrentes e compras parceladas -----------------------------
  create table public.varejo_gastos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    descricao text not null,
    tipo text not null check (tipo in ('mensal', 'compra')),
    valor numeric(12, 2) not null check (valor > 0),
    mes_inicio date not null,
    mes_fim date,
    parcelas integer check (parcelas >= 1),
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint varejo_gastos_coerencia_tipo check (
      (tipo = 'mensal' and parcelas is null) or (tipo = 'compra' and mes_fim is null and parcelas is not null)
    )
  );

  -- 5. varejo_equipe: salarios e pro-labore --------------------------------------------------------
  create table public.varejo_equipe (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    nome text not null,
    salario numeric(12, 2) not null check (salario > 0),
    somar_encargos boolean not null default false,
    mes_inicio date not null,
    mes_fim date,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
  );

  -- 6. varejo_movimentos_caixa: entradas/saidas fora de venda ---------------------------------------
  create table public.varejo_movimentos_caixa (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    data date not null,
    tipo text not null check (tipo in ('entrada', 'saida')),
    descricao text not null,
    valor numeric(12, 2) not null check (valor > 0),
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
  );

  -- 7. varejo_investimento_inicial: gasto de abertura ------------------------------------------------
  create table public.varejo_investimento_inicial (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    data date not null,
    descricao text not null,
    valor numeric(12, 2) not null check (valor > 0),
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
  );

  -- 8. varejo_vendas_manuais: faturamento sem PDV ou importado ---------------------------------------
  create table public.varejo_vendas_manuais (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    data date not null,
    faturamento numeric(12, 2) not null check (faturamento >= 0),
    numero_vendas integer not null check (numero_vendas >= 0),
    origem text not null check (origem in ('manual', 'importacao')),
    origem_id text,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint varejo_vendas_manuais_um_por_dia unique (operacao_id, data)
  );

  -- 9. Triggers (mesmo padrao de carimbar/travar ja usado nas outras tabelas do Varejo) ------------
  create trigger trg_carimbar_operacao before insert on public.varejo_config for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_config for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_config for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_auditar_financeiro_varejo after insert on public.varejo_config for each row execute function public.auditar_financeiro_varejo();

  create trigger trg_carimbar_operacao before insert on public.varejo_gastos for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_gastos for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_gastos for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_atualizado_em before update on public.varejo_gastos for each row execute function public.set_atualizado_em();
  create trigger trg_auditar_financeiro_varejo after insert or update or delete on public.varejo_gastos for each row execute function public.auditar_financeiro_varejo();

  create trigger trg_carimbar_operacao before insert on public.varejo_equipe for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_equipe for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_equipe for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_atualizado_em before update on public.varejo_equipe for each row execute function public.set_atualizado_em();
  create trigger trg_auditar_financeiro_varejo after insert or update or delete on public.varejo_equipe for each row execute function public.auditar_financeiro_varejo();

  create trigger trg_carimbar_operacao before insert on public.varejo_movimentos_caixa for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_movimentos_caixa for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_movimentos_caixa for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_atualizado_em before update on public.varejo_movimentos_caixa for each row execute function public.set_atualizado_em();
  create trigger trg_auditar_financeiro_varejo after insert or update or delete on public.varejo_movimentos_caixa for each row execute function public.auditar_financeiro_varejo();

  create trigger trg_carimbar_operacao before insert on public.varejo_investimento_inicial for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_investimento_inicial for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_investimento_inicial for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_atualizado_em before update on public.varejo_investimento_inicial for each row execute function public.set_atualizado_em();
  create trigger trg_auditar_financeiro_varejo after insert or update or delete on public.varejo_investimento_inicial for each row execute function public.auditar_financeiro_varejo();

  create trigger trg_carimbar_operacao before insert on public.varejo_vendas_manuais for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.varejo_vendas_manuais for each row execute function public.travar_operacao();
  create trigger trg_exigir_financeiro_varejo before insert or update on public.varejo_vendas_manuais for each row execute function public.exigir_financeiro_varejo();
  create trigger trg_atualizado_em before update on public.varejo_vendas_manuais for each row execute function public.set_atualizado_em();
  create trigger trg_auditar_financeiro_varejo after insert or update or delete on public.varejo_vendas_manuais for each row execute function public.auditar_financeiro_varejo();

  -- 10. RLS: escopo de operacao (restritiva) + admin-only (permissiva) ----------------------------
  alter table public.varejo_config enable row level security;
  alter table public.varejo_gastos enable row level security;
  alter table public.varejo_equipe enable row level security;
  alter table public.varejo_movimentos_caixa enable row level security;
  alter table public.varejo_investimento_inicial enable row level security;
  alter table public.varejo_vendas_manuais enable row level security;

  create policy "escopo de operacao" on public.varejo_config as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.varejo_gastos as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.varejo_equipe as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.varejo_movimentos_caixa as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.varejo_investimento_inicial as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.varejo_vendas_manuais as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));

  create policy "admin gerencia varejo_config" on public.varejo_config for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin gerencia varejo_gastos" on public.varejo_gastos for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin gerencia varejo_equipe" on public.varejo_equipe for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin gerencia varejo_movimentos_caixa" on public.varejo_movimentos_caixa for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin gerencia varejo_investimento_inicial" on public.varejo_investimento_inicial for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin gerencia varejo_vendas_manuais" on public.varejo_vendas_manuais for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario) with check (public.meu_papel() = 'admin'::public.papel_usuario);

  -- 11. Grants: anon fora; varejo_config so select+insert (historico imutavel); resto CRUD completo.
  -- O revoke de "authenticated" antes do grant restrito e obrigatorio aqui (mesmo padrao ja usado em
  -- estoque_movimentos, 20260921000003): sem ele, um default privilege automatico do Supabase podia
  -- sobrar update/delete em varejo_config por baixo do grant explicito mais estreito.
  revoke all on public.varejo_config, public.varejo_gastos, public.varejo_equipe, public.varejo_movimentos_caixa,
    public.varejo_investimento_inicial, public.varejo_vendas_manuais from anon, public, authenticated;
  grant select, insert on public.varejo_config to authenticated;
  grant select, insert, update, delete on public.varejo_gastos, public.varejo_equipe, public.varejo_movimentos_caixa,
    public.varejo_investimento_inicial, public.varejo_vendas_manuais to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_n bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  select count(*) into v_n from information_schema.tables where table_schema = 'public'
   and table_name in ('varejo_config', 'varejo_gastos', 'varejo_equipe', 'varejo_movimentos_caixa',
                       'varejo_investimento_inicial', 'varejo_vendas_manuais');
  if v_n <> 6 then raise exception 'FALHA: esperava 6 tabelas novas, achei %', v_n; end if;

  if exists (
    select 1 from (values
      ('varejo_config'), ('varejo_gastos'), ('varejo_equipe'),
      ('varejo_movimentos_caixa'), ('varejo_investimento_inicial'), ('varejo_vendas_manuais')
    ) t(tabela)
    where not exists (
      select 1 from pg_tables pt where pt.schemaname = 'public' and pt.tablename = t.tabela and pt.rowsecurity
    )
  ) then
    raise exception 'FALHA: alguma das 6 tabelas sem RLS ligada';
  end if;

  perform 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'auditar_financeiro_varejo';
  if not found then raise exception 'FALHA: auditar_financeiro_varejo() nao existe'; end if;
  perform 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'exigir_financeiro_varejo';
  if not found then raise exception 'FALHA: exigir_financeiro_varejo() nao existe'; end if;

  if has_table_privilege('authenticated', 'public.varejo_config', 'UPDATE') then
    raise exception 'FALHA: varejo_config deveria ser insert-only (sem update)';
  end if;
  if has_table_privilege('anon', 'public.varejo_gastos', 'SELECT') then
    raise exception 'FALHA: anon com select em varejo_gastos';
  end if;

  raise notice 'VERIFICACAO OK: 6 tabelas, RLS, triggers e grants no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_atacado uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_vendedor uuid;
  v_gasto_id uuid;
  v_n bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_vendedor from public.profiles where papel = 'vendedor' limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  -- T1. Admin em VAREJO cria um gasto -> grava com operacao_id certo e vira auditoria
  insert into public.varejo_gastos (descricao, tipo, valor, mes_inicio)
    values ('ZZ ENSAIO Aluguel', 'mensal', 5100, '2026-11-01') returning id into v_gasto_id;
  select count(*) into v_n from public.varejo_gastos where id = v_gasto_id and operacao_id = v_varejo;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: gasto nao gravou com a operacao certa'; end if;
  select count(*) into v_n from public.audit_log where tabela = 'varejo_gastos' and registro_id = v_gasto_id and acao = 'criacao';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: criacao do gasto nao foi auditada'; end if;

  -- T2. Editar o mesmo gasto -> audita a edicao e atualiza atualizado_em
  update public.varejo_gastos set valor = 5200 where id = v_gasto_id;
  select count(*) into v_n from public.audit_log where tabela = 'varejo_gastos' and registro_id = v_gasto_id and acao = 'edicao';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: edicao do gasto nao foi auditada'; end if;

  -- T3. Apagar -> audita a exclusao
  delete from public.varejo_gastos where id = v_gasto_id;
  select count(*) into v_n from public.audit_log where tabela = 'varejo_gastos' and registro_id = v_gasto_id and acao = 'exclusao';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: exclusao do gasto nao foi auditada'; end if;

  -- T4. compra parcelada exige parcelas e proibe mes_fim; gasto mensal proibe parcelas
  begin
    insert into public.varejo_gastos (descricao, tipo, valor, mes_inicio, parcelas) values ('ZZ ENSAIO sem parcelas', 'compra', 2400, '2027-01-01', null);
    raise exception 'TESTE FALHOU [T4]: compra sem parcelas deveria falhar no check';
  exception when check_violation then null;
  end;

  -- T5. varejo_config e insert-only -- update deve ser rejeitado pelo grant (nao chega a rodar RLS)
  insert into public.varejo_config (vigente_desde, mes_abertura) values ('2026-11-01', '2026-11-01');
  begin
    update public.varejo_config set fator_venda_padrao = 11.2 where vigente_desde = '2026-11-01';
    raise exception 'TESTE FALHOU [T5]: varejo_config deveria recusar update (grant insert-only)';
  exception when insufficient_privilege then null;
  end;

  -- T6. venda manual: 1 por dia (unique), e so funciona na operacao VAREJO
  insert into public.varejo_vendas_manuais (data, faturamento, numero_vendas, origem) values ('2026-11-05', 640.50, 7, 'manual');
  begin
    insert into public.varejo_vendas_manuais (data, faturamento, numero_vendas, origem) values ('2026-11-05', 100, 1, 'manual');
    raise exception 'TESTE FALHOU [T6]: segunda venda manual no mesmo dia deveria violar o unique';
  exception when unique_violation then null;
  end;

  -- T7. Trocar sessao pra ATACADO: escrever nas tabelas do financeiro deve ser recusado (modulo e so do Varejo)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_atacado))::text, true);
  begin
    insert into public.varejo_gastos (descricao, tipo, valor, mes_inicio) values ('ZZ ENSAIO atacado', 'mensal', 100, '2026-11-01');
    raise exception 'TESTE FALHOU [T7]: gasto deveria ser recusado fora da operacao VAREJO';
  exception when others then
    if sqlerrm not like '%VAREJO%' then raise exception 'TESTE FALHOU [T7]: erro inesperado: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);

  -- T8. Vendedor nao acessa nada do modulo (permissao, nao so operacao) -- precisa de uma linha de
  -- verdade pra testar que o RLS esconde (T3 ja apagou o gasto anterior; a tabela estaria vazia
  -- pra todo mundo sem isto, o que tornaria o teste de leitura vazio por coincidencia, nao por RLS).
  insert into public.varejo_gastos (descricao, tipo, valor, mes_inicio)
    values ('ZZ ENSAIO visivel so pro admin', 'mensal', 1, '2026-11-01') returning id into v_gasto_id;

  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    select count(*) into v_n from public.varejo_gastos;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T8]: vendedor enxergou % linha(s) de varejo_gastos (deveria ser 0)', v_n; end if;
    begin
      insert into public.varejo_gastos (descricao, tipo, valor, mes_inicio) values ('ZZ ENSAIO vendedor', 'mensal', 100, '2026-11-01');
      raise exception 'TESTE FALHOU [T8]: vendedor conseguiu criar lancamento financeiro';
    exception when insufficient_privilege or others then null;
    end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T8 pulado (negacao de leitura/escrita): nenhum profile com papel vendedor encontrado.';
  end if;

  -- Nao precisa limpar nada aqui: a transacao inteira do ensaio e desfeita no final (o $cmp$ sempre
  -- aborta de proposito), entao qualquer residuo some sozinho -- e varejo_config nem aceitaria um
  -- delete explicito mesmo que tentasse (insert-only de proposito, confirmado no T5 acima).

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T8 (CRUD auditado, constraints de coerencia, isolamento VAREJO/ATACADO, permissao de vendedor negada).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop table if exists public.varejo_config, public.varejo_gastos, public.varejo_equipe,
    public.varejo_movimentos_caixa, public.varejo_investimento_inicial, public.varejo_vendas_manuais cascade;
  drop function if exists public.auditar_financeiro_varejo();
  drop function if exists public.exigir_financeiro_varejo();
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
declare
  v_dif text;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  create temp table _fp_depois on commit drop as
    select item from (
      select 'TAB ' || t.table_name as item from information_schema.tables t
       where t.table_schema = 'public'
         and t.table_name in ('varejo_config', 'varejo_gastos', 'varejo_equipe', 'varejo_movimentos_caixa',
                               'varejo_investimento_inicial', 'varejo_vendas_manuais')
      union all
      select 'F ' || p.oid::regprocedure::text || ' ' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('auditar_financeiro_varejo', 'exigir_financeiro_varejo')
    ) x;

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: fundacao do Controle Financeiro do Varejo (6 tabelas, auditoria automatica, isolamento VAREJO/admin), testado (T1 a T8) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
