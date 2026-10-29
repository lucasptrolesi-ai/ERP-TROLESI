-- Painel "Meta do dia" do PDV Varejo ganha meta semanal e mensal, tambem configuraveis -- pedido
-- do usuario, 2026-10-29: "preciso de um medidor de meta assim como eu tenho o diario, porem
-- semana e mensal, ajustaveis".
--
-- `varejo_config` ganha `meta_semanal numeric` e `meta_mensal numeric` (mesmo padrao de
-- `meta_diaria`: default sensato, editavel em "Nova vigencia" em /varejo/financeiro). Default
-- semanal = 6x a meta diaria padrao (500), default mensal = dias_abertos_mes padrao (26) x meta
-- diaria -- so ponto de partida, o usuario ajusta como quiser.
--
-- Faturamento da semana/mes NAO precisa de calculo novo no banco -- o server component do PDV ja
-- busca `vendas` numa janela de dias (pro grafico de 7 dias); so alarga a janela pra cobrir o
-- inicio do mes tambem, e soma em JS (igual o resto do painel ja faz).
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro
-- -- de novo. Perde so o valor das metas configuradas (recriavel a qualquer momento -- nao e dado
-- -- financeiro real).
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

  alter table public.varejo_config add column meta_semanal numeric not null default 3000 check (meta_semanal > 0);
  alter table public.varejo_config add column meta_mensal numeric not null default 13000 check (meta_mensal > 0);
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'varejo_config' and column_name = 'meta_semanal'
  ) then
    raise exception 'FALHA: varejo_config.meta_semanal nao existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'varejo_config' and column_name = 'meta_mensal'
  ) then
    raise exception 'FALHA: varejo_config.meta_mensal nao existe';
  end if;

  raise notice 'VERIFICACAO OK: varejo_config.meta_semanal e meta_mensal no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_meta_semanal numeric;
  v_meta_mensal numeric;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  -- T1. Config existente ganhou os defaults (3000/13000) sem precisar de migracao de dado.
  select meta_semanal, meta_mensal into v_meta_semanal, v_meta_mensal
    from public.varejo_config order by vigente_desde desc limit 1;
  if v_meta_semanal is null or v_meta_semanal <> 3000 then
    raise exception 'TESTE FALHOU [T1]: meta_semanal deveria ser 3000 por default, veio %', v_meta_semanal;
  end if;
  if v_meta_mensal is null or v_meta_mensal <> 13000 then
    raise exception 'TESTE FALHOU [T1]: meta_mensal deveria ser 13000 por default, veio %', v_meta_mensal;
  end if;

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 (meta_semanal/meta_mensal defaults).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  alter table public.varejo_config drop column if exists meta_semanal;
  alter table public.varejo_config drop column if exists meta_mensal;
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'varejo_config' and column_name in ('meta_semanal', 'meta_mensal')
  ) then
    raise exception 'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado original.';
  end if;

  raise exception 'ENSAIO OK: meta_semanal e meta_mensal testadas (T1) e desfeitas -- nada foi gravado de verdade (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
