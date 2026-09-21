-- Etapa 4 do modulo de varejo: caixa, supervisor e auditoria.
-- Pre-requisito: etapas 1, 2 e 3 aplicadas (operacao_atual, carimbar_operacao, arredondar_moeda).
--
-- O QUE FAZ (uma transacao so):
--   1. SESSAO DE CAIXA: abertura com fundo de troco, sangria, suprimento e fechamento CEGO. O operador
--      informa o valor contado ANTES de o sistema revelar o esperado; grava valor_informado,
--      valor_esperado e divergencia. Ninguem grava direto: so as functions. Cada movimento e auditado.
--      O vendedor le apenas a propria sessao ABERTA (view minha_sessao_caixa): nao le sessoes
--      anteriores, nem valor esperado, nem divergencia. Movimentos de caixa sao append-only.
--   2. SUPERVISOR + PIN: PIN de 4 a 8 digitos guardado com bcrypt (pgcrypto). autorizar_acao() valida o
--      PIN e devolve uma AUTORIZACAO PONTUAL: vale para uma acao, uma vez so, por 5 minutos, presa a
--      quem pediu; NAO libera a sessao. 5 erros bloqueiam o supervisor por 10 minutos (o contador de
--      erros persiste porque a function devolve o resultado em vez de lancar excecao). Supervisor
--      nao autoriza a si mesmo. Fica registrado quem autorizou.
--   3. AUDITORIA COM IP: audit_log ganha ip (primeiro IP do x-forwarded-for visto pelo PostgREST) e
--      ip_cliente (header x-client-ip informado pelo app) por trigger, e passa a ser append-only.
--
-- COMO RODAR: igual as etapas anteriores. Modo padrao 'ensaio' (aplica, verifica, testa, desfaz e
-- compara o schema; termina com "ENSAIO OK", nada e gravado). Depois 'aplicar'. Rollback: 'desfazer'.

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

create temp table _op4_pendencias (chave text primary key, descricao text not null) on commit drop;

insert into _op4_pendencias (chave, descricao) values
  ('pin_supervisor_politica',
   'PIN de 4 a 8 digitos (bcrypt); 5 erros bloqueiam o supervisor por 10 min; autorizacao valida por 5 min, de uso unico e presa a quem pediu; supervisor nao autoriza a si mesmo. Confirmar esta politica com o usuario e cadastrar os supervisores (definir_pin_supervisor, so admin).'),
  ('auditoria_ip_confiavel',
   'audit_log.ip e o primeiro IP do x-forwarded-for visto pelo PostgREST (nas chamadas do servidor Next e o IP da Vercel) e ip_cliente e o header x-client-ip informado pelo app, que NAO e confiavel contra chamada direta ao PostgREST. Para IP confiavel do usuario final, o app deve repassar o IP com segredo compartilhado validado no banco.'),
  ('estorno_parcial_devolucao',
   'A etapa 5 implementa cancelamento total de venda com autorizacao de supervisor. Estorno parcial, devolucao por item e troca ficam pendentes.'),
  ('caixa_saldo_esperado_vazamento',
   'A mensagem de sangria maior que o dinheiro em caixa revela, por comparacao, um limite do saldo esperado. Se o fechamento cego precisar ser estrito, trocar por mensagem generica.');

create temp table _op_contagens_antes (tabela text primary key, n bigint not null) on commit drop;

do $lock$
begin
  lock table public.audit_log in access exclusive mode;
  lock table public.caixas in access exclusive mode;
  lock table public.pending_decisions in access exclusive mode;
end $lock$;

create or replace function pg_temp.fp_schema_base() returns table(item text) language sql as $f$
  select 'T ' || c.relname || ' ' || c.relkind::text
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p')
  union all
  select 'C ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'K ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'I ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'P ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'G ' || tgrelid::regclass::text || ' ' || tgname
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'D pending_decisions ' || count(*) || ' ' || count(*) filter (where ativo) from public.pending_decisions
  union all
  select 'S caixas ' || count(*) from public.caixas
$f$;

create temp table _fp_antes on commit drop as select item from pg_temp.fp_schema_base();

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.arredondar_moeda(numeric)') is null then
    raise exception 'ABORTADO: etapa 3 nao aplicada (arredondar_moeda ausente).';
  end if;
  if to_regclass('public.caixa_sessoes') is not null then
    raise exception 'ABORTADO: etapa 4 parece ja aplicada (caixa_sessoes existe).';
  end if;

  -- 1. Auditoria com IP + append-only ------------------------------------------------------------------
  alter table public.audit_log add column ip inet, add column ip_cliente text;

  create or replace function public.carimbar_ip_auditoria() returns trigger
  language plpgsql as $fn$
  declare
    v_h jsonb;
  begin
    begin
      v_h := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      v_h := null;
    end;
    if v_h is not null then
      begin
        new.ip := nullif(trim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), '')::inet;
      exception when others then
        new.ip := null;
      end;
      new.ip_cliente := nullif(left(v_h ->> 'x-client-ip', 64), '');
    end if;
    return new;
  end
  $fn$;
  create trigger trg_carimbar_ip_auditoria before insert on public.audit_log
    for each row execute function public.carimbar_ip_auditoria();

  create or replace function public.bloquear_alteracao_registro() returns trigger
  language plpgsql as $fn$
  begin
    raise exception 'Registro append-only: nao pode ser alterado nem apagado' using errcode = '55000';
  end
  $fn$;
  create trigger trg_audit_append_only before update or delete on public.audit_log
    for each row execute function public.bloquear_alteracao_registro();
  create trigger trg_audit_sem_truncate before truncate on public.audit_log
    for each statement execute function public.bloquear_alteracao_registro();

  -- 2. Caixa liga ao deposito --------------------------------------------------------------------------
  alter table public.caixas add column deposito_id uuid;
  update public.caixas c set deposito_id = (select d.id from public.depositos d where d.operacao_id = c.operacao_id and d.nome = 'LOJA')
   where c.nome = 'CAIXA 1';
  alter table public.caixas add constraint caixas_deposito_op_fkey foreign key (deposito_id, operacao_id)
    references public.depositos (id, operacao_id);

  -- 3. Supervisores e autorizacoes pontuais --------------------------------------------------------------
  create table public.supervisores (
    profile_id uuid not null references public.profiles (id) on delete cascade,
    operacao_id uuid not null references public.operacoes (id),
    pin_hash text not null,
    ativo boolean not null default true,
    tentativas_falhas integer not null default 0,
    bloqueado_ate timestamptz,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    primary key (profile_id, operacao_id)
  );

  create table public.autorizacoes_pontuais (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    acao text not null check (acao in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento')),
    supervisor_id uuid not null references public.profiles (id),
    solicitante_id uuid not null references public.profiles (id),
    alvo_id uuid,
    criada_em timestamptz not null default now(),
    expira_em timestamptz not null,
    usada_em timestamptz,
    constraint autorizacoes_pontuais_id_operacao_key unique (id, operacao_id)
  );
  create index autorizacoes_pontuais_operacao_id_idx on public.autorizacoes_pontuais (operacao_id);

  -- 4. Sessao de caixa e movimentos --------------------------------------------------------------------------
  create table public.caixa_sessoes (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    caixa_id uuid not null,
    operador_id uuid not null references public.profiles (id),
    status text not null default 'aberta' check (status in ('aberta', 'fechada')),
    fundo_troco numeric(12, 2) not null check (fundo_troco >= 0),
    aberta_em timestamptz not null default now(),
    fechada_em timestamptz,
    valor_informado numeric(12, 2),
    valor_esperado numeric(12, 2),
    divergencia numeric(12, 2),
    constraint caixa_sessoes_id_operacao_key unique (id, operacao_id),
    constraint caixa_sessoes_caixa_op_fkey foreign key (caixa_id, operacao_id) references public.caixas (id, operacao_id),
    constraint caixa_sessoes_estado check (
      (status = 'aberta' and fechada_em is null and valor_informado is null and valor_esperado is null and divergencia is null)
      or (status = 'fechada' and fechada_em is not null and valor_informado is not null and valor_esperado is not null and divergencia is not null))
  );
  create unique index caixa_sessoes_uma_aberta_por_caixa on public.caixa_sessoes (caixa_id) where status = 'aberta';
  create unique index caixa_sessoes_uma_aberta_por_operador on public.caixa_sessoes (operador_id) where status = 'aberta';
  create index caixa_sessoes_operacao_id_idx on public.caixa_sessoes (operacao_id);

  create table public.caixa_movimentos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    sessao_id uuid not null,
    tipo text not null check (tipo in ('abertura', 'suprimento', 'sangria', 'venda_dinheiro', 'estorno_dinheiro')),
    valor numeric(12, 2) not null,
    motivo text,
    documento_id uuid,
    autorizado_por uuid references public.profiles (id),
    criado_por uuid references public.profiles (id),
    criado_em timestamptz not null default now(),
    constraint caixa_movimentos_valor check ((tipo = 'abertura' and valor >= 0) or (tipo <> 'abertura' and valor > 0)),
    constraint caixa_movimentos_sessao_op_fkey foreign key (sessao_id, operacao_id) references public.caixa_sessoes (id, operacao_id)
  );
  create index caixa_movimentos_operacao_id_idx on public.caixa_movimentos (operacao_id);
  create index caixa_movimentos_sessao_idx on public.caixa_movimentos (sessao_id);

  create trigger trg_caixa_movimentos_append_only before update or delete on public.caixa_movimentos
    for each row execute function public.bloquear_alteracao_registro();
  create trigger trg_caixa_movimentos_sem_truncate before truncate on public.caixa_movimentos
    for each statement execute function public.bloquear_alteracao_registro();

  -- carimbo de operacao (mesmo padrao da etapa 2) + escopo restritivo
  create trigger trg_carimbar_operacao before insert on public.autorizacoes_pontuais for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.autorizacoes_pontuais for each row execute function public.travar_operacao();
  create trigger trg_carimbar_operacao before insert on public.caixa_sessoes for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.caixa_sessoes for each row execute function public.travar_operacao();
  create trigger trg_carimbar_operacao before insert on public.caixa_movimentos for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.caixa_movimentos for each row execute function public.travar_operacao();

  alter table public.supervisores enable row level security;
  alter table public.autorizacoes_pontuais enable row level security;
  alter table public.caixa_sessoes enable row level security;
  alter table public.caixa_movimentos enable row level security;

  create policy "escopo de operacao" on public.supervisores as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.autorizacoes_pontuais as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.caixa_sessoes as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.caixa_movimentos as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));

  -- Leitura direta so do admin (tem valor esperado e divergencia). supervisores: ninguem (tem o hash).
  create policy "admin le autorizacoes_pontuais" on public.autorizacoes_pontuais for select to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin le caixa_sessoes" on public.caixa_sessoes for select to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario);
  create policy "admin le caixa_movimentos" on public.caixa_movimentos for select to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario);

  revoke all on public.supervisores, public.autorizacoes_pontuais, public.caixa_sessoes, public.caixa_movimentos from anon, authenticated;
  grant select on public.autorizacoes_pontuais, public.caixa_sessoes, public.caixa_movimentos to authenticated;

  create view public.minha_sessao_caixa as
    select s.id as sessao_id, s.caixa_id, c.nome as caixa_nome, c.deposito_id, s.aberta_em, s.fundo_troco, s.status
      from public.caixa_sessoes s
      join public.caixas c on c.id = s.caixa_id and c.operacao_id = s.operacao_id
     where s.operacao_id = (select public.operacao_atual()) and s.operador_id = auth.uid() and s.status = 'aberta';

  create view public.pdv_supervisores as
    select sv.profile_id, p.nome
      from public.supervisores sv
      join public.profiles p on p.id = sv.profile_id
     where sv.operacao_id = (select public.operacao_atual()) and sv.ativo and p.ativo and sv.profile_id <> auth.uid();

  revoke all on public.minha_sessao_caixa, public.pdv_supervisores from anon, authenticated;
  grant select on public.minha_sessao_caixa, public.pdv_supervisores to authenticated;

  -- 5. Functions ------------------------------------------------------------------------------------------------
  create or replace function public.saldo_esperado_sessao(p_sessao_id uuid) returns numeric
  language sql stable security definer set search_path = public as $fn$
    select coalesce(sum(case when m.tipo in ('abertura', 'suprimento', 'venda_dinheiro') then m.valor else -m.valor end), 0)
      from public.caixa_movimentos m
     where m.sessao_id = p_sessao_id and m.operacao_id = public.operacao_atual()
  $fn$;

  create or replace function public.definir_pin_supervisor(p_profile_id uuid, p_pin text) returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
  begin
    perform public.assert_papel(array['admin']::public.papel_usuario[]);
    if v_op is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
      raise exception 'O PIN deve ter de 4 a 8 digitos';
    end if;
    if not exists (select 1 from public.usuario_operacoes uo where uo.profile_id = p_profile_id and uo.operacao_id = v_op) then
      raise exception 'O usuario nao tem acesso a esta operacao';
    end if;
    insert into public.supervisores (profile_id, operacao_id, pin_hash)
    values (p_profile_id, v_op, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
    on conflict (profile_id, operacao_id) do update
      set pin_hash = excluded.pin_hash, ativo = true, tentativas_falhas = 0, bloqueado_ate = null, atualizado_em = now();
    perform public.registrar_auditoria('supervisores', p_profile_id, 'definir_pin_supervisor', null,
      jsonb_build_object('ativo', true), null);
  end
  $fn$;

  create or replace function public.autorizar_acao(p_supervisor_id uuid, p_pin text, p_acao text, p_alvo_id uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_sv public.supervisores%rowtype;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    if v_op is null then
      raise exception 'Sem operacao ativa na sessao' using errcode = '42501';
    end if;
    if p_acao not in ('desconto_abaixo_piso', 'cancelamento_venda', 'estorno_pagamento') then
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
  $fn$;

  create or replace function public.consumir_autorizacao(p_id uuid, p_acao text, p_alvo_id uuid default null) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_a public.autorizacoes_pontuais%rowtype;
  begin
    select * into v_a from public.autorizacoes_pontuais where id = p_id and operacao_id = public.operacao_atual() for update;
    if not found then
      raise exception 'Autorizacao invalida';
    end if;
    if v_a.usada_em is not null then
      raise exception 'Autorizacao ja utilizada';
    end if;
    if v_a.expira_em < now() then
      raise exception 'Autorizacao expirada';
    end if;
    if v_a.acao <> p_acao then
      raise exception 'Autorizacao de outra acao';
    end if;
    if v_a.solicitante_id <> auth.uid() then
      raise exception 'Autorizacao pertence a outro operador';
    end if;
    if v_a.alvo_id is not null and v_a.alvo_id is distinct from p_alvo_id then
      raise exception 'Autorizacao de outro registro';
    end if;
    update public.autorizacoes_pontuais set usada_em = now() where id = p_id;
    return v_a.supervisor_id;
  end
  $fn$;

  create or replace function public.abrir_sessao_caixa(p_caixa_id uuid, p_fundo_troco numeric) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_id uuid;
    v_fundo numeric;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    if p_fundo_troco is null or p_fundo_troco < 0 then
      raise exception 'Fundo de troco invalido';
    end if;
    v_fundo := public.arredondar_moeda(p_fundo_troco);
    if not exists (select 1 from public.caixas c where c.id = p_caixa_id and c.operacao_id = public.operacao_atual() and c.ativo) then
      raise exception 'Caixa nao encontrado ou inativo';
    end if;
    insert into public.caixa_sessoes (caixa_id, operador_id, status, fundo_troco)
    values (p_caixa_id, auth.uid(), 'aberta', v_fundo) returning id into v_id;
    insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, criado_por)
    values (v_id, 'abertura', v_fundo, 'Abertura com fundo de troco', auth.uid());
    perform public.registrar_auditoria('caixa_sessoes', v_id, 'abertura_caixa', null,
      jsonb_build_object('caixa_id', p_caixa_id, 'fundo_troco', v_fundo), null);
    return v_id;
  exception when unique_violation then
    raise exception 'Ja existe sessao de caixa aberta (deste caixa ou deste operador)';
  end
  $fn$;

  create or replace function public.registrar_suprimento(p_sessao_id uuid, p_valor numeric, p_motivo text) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_s public.caixa_sessoes%rowtype;
    v_valor numeric;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    select * into v_s from public.caixa_sessoes where id = p_sessao_id and operacao_id = public.operacao_atual() for update;
    if not found or v_s.status <> 'aberta' then
      raise exception 'Sessao de caixa nao encontrada ou ja fechada';
    end if;
    if v_s.operador_id <> auth.uid() then
      raise exception 'A sessao de caixa pertence a outro operador';
    end if;
    v_valor := public.arredondar_moeda(p_valor);
    if v_valor is null or v_valor <= 0 then
      raise exception 'Valor invalido';
    end if;
    if p_motivo is null or length(trim(p_motivo)) = 0 then
      raise exception 'Motivo obrigatorio';
    end if;
    insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, criado_por)
    values (p_sessao_id, 'suprimento', v_valor, p_motivo, auth.uid()) returning id into v_id;
    perform public.registrar_auditoria('caixa_movimentos', v_id, 'suprimento_caixa', null,
      jsonb_build_object('sessao_id', p_sessao_id, 'valor', v_valor), p_motivo);
    return v_id;
  end
  $fn$;

  create or replace function public.registrar_sangria(p_sessao_id uuid, p_valor numeric, p_motivo text) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_s public.caixa_sessoes%rowtype;
    v_valor numeric;
    v_id uuid;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    select * into v_s from public.caixa_sessoes where id = p_sessao_id and operacao_id = public.operacao_atual() for update;
    if not found or v_s.status <> 'aberta' then
      raise exception 'Sessao de caixa nao encontrada ou ja fechada';
    end if;
    if v_s.operador_id <> auth.uid() then
      raise exception 'A sessao de caixa pertence a outro operador';
    end if;
    v_valor := public.arredondar_moeda(p_valor);
    if v_valor is null or v_valor <= 0 then
      raise exception 'Valor invalido';
    end if;
    if p_motivo is null or length(trim(p_motivo)) = 0 then
      raise exception 'Motivo obrigatorio';
    end if;
    if v_valor > public.saldo_esperado_sessao(p_sessao_id) then
      raise exception 'Sangria maior que o dinheiro em caixa';
    end if;
    insert into public.caixa_movimentos (sessao_id, tipo, valor, motivo, criado_por)
    values (p_sessao_id, 'sangria', v_valor, p_motivo, auth.uid()) returning id into v_id;
    perform public.registrar_auditoria('caixa_movimentos', v_id, 'sangria_caixa', null,
      jsonb_build_object('sessao_id', p_sessao_id, 'valor', v_valor), p_motivo);
    return v_id;
  end
  $fn$;

  create or replace function public.fechar_sessao_caixa(p_sessao_id uuid, p_valor_informado numeric) returns jsonb
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_s public.caixa_sessoes%rowtype;
    v_inf numeric;
    v_esp numeric;
    v_div numeric;
  begin
    perform public.assert_papel(array['admin', 'vendedor']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');
    select * into v_s from public.caixa_sessoes where id = p_sessao_id and operacao_id = public.operacao_atual() for update;
    if not found or v_s.status <> 'aberta' then
      raise exception 'Sessao de caixa nao encontrada ou ja fechada';
    end if;
    if v_s.operador_id <> auth.uid() then
      raise exception 'A sessao de caixa pertence a outro operador';
    end if;
    v_inf := public.arredondar_moeda(p_valor_informado);
    if v_inf is null or v_inf < 0 then
      raise exception 'Valor contado invalido';
    end if;
    -- Fechamento cego: o valor contado ja foi recebido; so agora o esperado e calculado e revelado.
    v_esp := public.saldo_esperado_sessao(p_sessao_id);
    v_div := v_inf - v_esp;
    update public.caixa_sessoes
       set status = 'fechada', fechada_em = now(), valor_informado = v_inf, valor_esperado = v_esp, divergencia = v_div
     where id = p_sessao_id;
    perform public.registrar_auditoria('caixa_sessoes', p_sessao_id, 'fechamento_caixa',
      jsonb_build_object('status', 'aberta'),
      jsonb_build_object('status', 'fechada', 'valor_informado', v_inf, 'valor_esperado', v_esp, 'divergencia', v_div), null);
    return jsonb_build_object('valor_informado', v_inf, 'valor_esperado', v_esp, 'divergencia', v_div);
  end
  $fn$;

  revoke execute on function public.saldo_esperado_sessao(uuid), public.consumir_autorizacao(uuid, text, uuid),
    public.definir_pin_supervisor(uuid, text), public.autorizar_acao(uuid, text, text, uuid),
    public.abrir_sessao_caixa(uuid, numeric), public.registrar_suprimento(uuid, numeric, text),
    public.registrar_sangria(uuid, numeric, text), public.fechar_sessao_caixa(uuid, numeric)
    from public, anon, authenticated;
  grant execute on function public.definir_pin_supervisor(uuid, text), public.autorizar_acao(uuid, text, text, uuid),
    public.abrir_sessao_caixa(uuid, numeric), public.registrar_suprimento(uuid, numeric, text),
    public.registrar_sangria(uuid, numeric, text), public.fechar_sessao_caixa(uuid, numeric)
    to authenticated;

  insert into public.pending_decisions (chave, descricao, ativo)
  select chave, descricao, false from _op4_pendencias;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
  v_m bigint;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select count(*) into v_n from pg_policies where schemaname = 'public' and policyname = 'escopo de operacao' and permissive = 'RESTRICTIVE'
     and tablename in ('supervisores', 'autorizacoes_pontuais', 'caixa_sessoes', 'caixa_movimentos');
  if v_n <> 4 then raise exception 'FALHA: politicas restritivas novas = %, esperado 4', v_n; end if;

  select count(*) into v_n from pg_trigger where not tgisinternal and tgname = 'trg_carimbar_operacao'
     and tgrelid in ('public.autorizacoes_pontuais'::regclass, 'public.caixa_sessoes'::regclass, 'public.caixa_movimentos'::regclass);
  if v_n <> 3 then raise exception 'FALHA: triggers de carimbo novos = %, esperado 3', v_n; end if;

  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name in ('ip', 'ip_cliente');
  if v_n <> 2 then raise exception 'FALHA: colunas de IP em audit_log = %, esperado 2', v_n; end if;

  select count(*) into v_n from public.caixas where deposito_id is not null;
  if v_n < 1 then raise exception 'FALHA: nenhum caixa ligado a deposito'; end if;

  select count(*) into v_n from pg_class where relnamespace = 'public'::regnamespace and relname in ('minha_sessao_caixa', 'pdv_supervisores') and relkind = 'v';
  if v_n <> 2 then raise exception 'FALHA: views do PDV = %, esperado 2', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name in ('minha_sessao_caixa', 'pdv_supervisores')
     and (column_name ilike '%esperado%' or column_name ilike '%divergencia%' or column_name ilike '%pin%' or column_name ilike '%hash%');
  if v_n <> 0 then raise exception 'FALHA: views do PDV expoem % colunas sensiveis', v_n; end if;

  select count(*) into v_n from public.pending_decisions where chave in (select chave from _op4_pendencias);
  select count(*) into v_m from _op4_pendencias;
  if v_n <> v_m then raise exception 'FALHA: pendencias = %, esperado %', v_n, v_m; end if;

  raise notice 'VERIFICACAO OK: caixa, supervisores, autorizacoes pontuais, IP na auditoria.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_caixa uuid;
  v_sessao uuid;
  v_aut uuid;
  v_json jsonb;
  v_n bigint;
  v_x numeric;
  v_ok boolean;
  i integer;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_caixa from public.caixas where operacao_id = v_varejo and nome = 'CAIXA 1';

  -- Cenario: Barbara e vendedora so do VAREJO; VAREJO ativo (nesta transacao)
  update public.operacoes set ativo = true where id = v_varejo;
  delete from public.usuario_operacoes where profile_id = v_barbara and operacao_id = v_atacado;
  insert into public.usuario_operacoes (profile_id, operacao_id, padrao) values (v_barbara, v_varejo, true);

  -- T1. Admin define o PIN do supervisor (Lucas); o PIN e guardado com hash
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  perform public.definir_pin_supervisor(v_lucas, '1234');
  v_ok := false;
  begin
    perform public.definir_pin_supervisor(v_lucas, '12');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T1]: PIN curto foi aceito'; end if;
  execute 'reset role';
  select count(*) into v_n from public.supervisores where profile_id = v_lucas and pin_hash like '$2%' and pin_hash <> '1234';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: PIN nao foi guardado com hash bcrypt'; end if;

  -- T2. Barbara (operadora): nao define PIN, nao le supervisores, ve a lista sem hash
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ok := false;
  begin
    perform public.definir_pin_supervisor(v_barbara, '9999');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T2]: vendedora definiu PIN'; end if;
  v_ok := false;
  begin
    execute 'select count(*) from public.supervisores';
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T2]: vendedora leu a tabela supervisores (tem hash)'; end if;
  select count(*) into v_n from public.pdv_supervisores where profile_id = v_lucas;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: lista de supervisores no PDV = %, esperado 1', v_n; end if;

  -- T3. Abre a sessao; so ve a propria sessao aberta; nao le a tabela; nao abre duas
  v_sessao := public.abrir_sessao_caixa(v_caixa, 100);
  select count(*) into v_n from public.minha_sessao_caixa where sessao_id = v_sessao;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: minha_sessao_caixa = %, esperado 1', v_n; end if;
  v_ok := false;
  begin
    execute 'select count(*) from public.caixa_sessoes';
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T3]: vendedora leu caixa_sessoes (tem esperado e divergencia)'; end if;
  v_ok := false;
  begin
    perform public.abrir_sessao_caixa(v_caixa, 50);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T3]: abriu segunda sessao no mesmo caixa'; end if;

  -- T4. Suprimento e sangria; regras de valor e motivo
  perform public.registrar_suprimento(v_sessao, 50, 'reforco de troco');
  perform public.registrar_sangria(v_sessao, 30, 'sangria ao cofre');
  v_ok := false;
  begin
    perform public.registrar_sangria(v_sessao, 500, 'maior que o caixa');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: sangria maior que o caixa foi aceita'; end if;
  v_ok := false;
  begin
    perform public.registrar_sangria(v_sessao, 10, '   ');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T4]: sangria sem motivo foi aceita'; end if;
  execute 'reset role';
  v_x := public.saldo_esperado_sessao(v_sessao);
  if v_x <> 120 then raise exception 'TESTE FALHOU [T4]: saldo esperado = %, esperado 120', v_x; end if;

  -- T5. PIN: 5 erros bloqueiam; contador persiste (a function nao lanca excecao)
  execute 'set local role authenticated';
  for i in 1..5 loop
    v_json := public.autorizar_acao(v_lucas, '0000', 'cancelamento_venda', null);
    if (v_json ->> 'ok')::boolean or (v_json ->> 'motivo') <> 'pin_invalido' then
      raise exception 'TESTE FALHOU [T5]: tentativa % com PIN errado devolveu %', i, v_json;
    end if;
  end loop;
  v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', null);
  if (v_json ->> 'motivo') is distinct from 'bloqueado' then raise exception 'TESTE FALHOU [T5]: supervisor nao foi bloqueado: %', v_json; end if;
  execute 'reset role';
  select tentativas_falhas into v_n from public.supervisores where profile_id = v_lucas;
  if v_n <> 5 then raise exception 'TESTE FALHOU [T5]: contador de erros = %, esperado 5 (nao persistiu)', v_n; end if;
  update public.supervisores set tentativas_falhas = 0, bloqueado_ate = null where profile_id = v_lucas;

  -- T6. PIN correto gera autorizacao pontual; supervisor nao autoriza a si mesmo
  execute 'set local role authenticated';
  v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', null);
  if not (v_json ->> 'ok')::boolean then raise exception 'TESTE FALHOU [T6]: PIN correto recusado: %', v_json; end if;
  v_aut := (v_json ->> 'autorizacao_id')::uuid;
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  v_json := public.autorizar_acao(v_lucas, '1234', 'cancelamento_venda', null);
  if (v_json ->> 'motivo') is distinct from 'auto_autorizacao' then raise exception 'TESTE FALHOU [T6]: supervisor autorizou a si mesmo: %', v_json; end if;
  execute 'reset role';

  -- T7. Autorizacao: uso unico, presa a quem pediu, acao certa, expira
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  if public.consumir_autorizacao(v_aut, 'cancelamento_venda', null) <> v_lucas then
    raise exception 'TESTE FALHOU [T7]: a autorizacao nao registrou quem autorizou';
  end if;
  v_ok := false;
  begin
    perform public.consumir_autorizacao(v_aut, 'cancelamento_venda', null);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: autorizacao foi usada duas vezes'; end if;
  execute 'set local role authenticated';
  v_json := public.autorizar_acao(v_lucas, '1234', 'desconto_abaixo_piso', v_sessao);
  execute 'reset role';
  v_aut := (v_json ->> 'autorizacao_id')::uuid;
  v_ok := false;
  begin
    perform public.consumir_autorizacao(v_aut, 'cancelamento_venda', null);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: autorizacao de desconto serviu para cancelamento'; end if;
  v_ok := false;
  begin
    perform public.consumir_autorizacao(v_aut, 'desconto_abaixo_piso', gen_random_uuid());
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: autorizacao serviu para outro registro'; end if;
  update public.autorizacoes_pontuais set expira_em = now() - interval '1 minute' where id = v_aut;
  v_ok := false;
  begin
    perform public.consumir_autorizacao(v_aut, 'desconto_abaixo_piso', v_sessao);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: autorizacao expirada foi aceita'; end if;

  -- T8. Fechamento cego: informa 118, o sistema revela esperado 120 e divergencia -2
  execute 'set local role authenticated';
  v_json := public.fechar_sessao_caixa(v_sessao, 118);
  if (v_json ->> 'valor_esperado')::numeric <> 120 or (v_json ->> 'divergencia')::numeric <> -2
     or (v_json ->> 'valor_informado')::numeric <> 118 then
    raise exception 'TESTE FALHOU [T8]: fechamento devolveu %', v_json;
  end if;
  select count(*) into v_n from public.minha_sessao_caixa;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T8]: sessao fechada continua visivel para a operadora'; end if;
  v_ok := false;
  begin
    perform public.fechar_sessao_caixa(v_sessao, 118);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T8]: fechou a mesma sessao duas vezes'; end if;
  execute 'reset role';
  select count(*) into v_n from public.caixa_sessoes
   where id = v_sessao and status = 'fechada' and valor_informado = 118 and valor_esperado = 120 and divergencia = -2;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T8]: fechamento nao gravou informado, esperado e divergencia'; end if;

  -- T9. Auditoria de todos os movimentos de caixa e do fechamento, com o usuario
  select count(*) into v_n from public.audit_log
   where usuario_id = v_barbara and acao in ('abertura_caixa', 'suprimento_caixa', 'sangria_caixa', 'fechamento_caixa');
  if v_n <> 4 then raise exception 'TESTE FALHOU [T9]: auditorias de caixa = %, esperado 4', v_n; end if;
  select count(*) into v_n from public.audit_log where acao = 'autorizacao_concedida' and (valor_novo ->> 'supervisor_id')::uuid = v_lucas;
  if v_n < 2 then raise exception 'TESTE FALHOU [T9]: autorizacoes nao registram o supervisor (% linhas)', v_n; end if;

  -- T10. IP na auditoria (cabecalhos como o PostgREST entrega) e operacao carimbada
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-client-ip": "198.51.100.7"}', true);
  perform public.registrar_auditoria('teste_ip', gen_random_uuid(), 'teste_ip', null, null, null);
  perform set_config('request.headers', '', true);
  select count(*) into v_n from public.audit_log where acao = 'teste_ip' and ip = '203.0.113.9'::inet and ip_cliente = '198.51.100.7' and operacao_id = v_varejo;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T10]: IP/operacao nao foram carimbados na auditoria'; end if;

  -- T11. Append-only: auditoria e movimentos de caixa nao mudam nem para o dono
  v_ok := false;
  begin
    update public.audit_log set justificativa = 'x' where acao = 'teste_ip';
  exception when object_not_in_prerequisite_state then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T11]: audit_log foi alterado'; end if;
  v_ok := false;
  begin
    delete from public.caixa_movimentos where sessao_id = v_sessao;
  exception when object_not_in_prerequisite_state then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T11]: caixa_movimentos foi apagado'; end if;

  -- T12. Isolamento: Lucas em contexto ATACADO nao ve sessoes nem movimentos do varejo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.caixa_sessoes;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T12]: contexto ATACADO viu % sessoes de caixa', v_n; end if;
  select count(*) into v_n from public.caixa_movimentos;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T12]: contexto ATACADO viu % movimentos de caixa', v_n; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T12 (PIN, sessao, fechamento cego, autorizacao pontual, auditoria com IP, append-only, isolamento).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop view if exists public.minha_sessao_caixa;
  drop view if exists public.pdv_supervisores;
  drop table if exists public.caixa_movimentos, public.caixa_sessoes, public.autorizacoes_pontuais, public.supervisores;

  drop function if exists public.fechar_sessao_caixa(uuid, numeric);
  drop function if exists public.registrar_sangria(uuid, numeric, text);
  drop function if exists public.registrar_suprimento(uuid, numeric, text);
  drop function if exists public.abrir_sessao_caixa(uuid, numeric);
  drop function if exists public.consumir_autorizacao(uuid, text, uuid);
  drop function if exists public.autorizar_acao(uuid, text, text, uuid);
  drop function if exists public.definir_pin_supervisor(uuid, text);
  drop function if exists public.saldo_esperado_sessao(uuid);

  alter table public.caixas drop constraint if exists caixas_deposito_op_fkey;
  alter table public.caixas drop column if exists deposito_id;

  drop trigger if exists trg_audit_append_only on public.audit_log;
  drop trigger if exists trg_audit_sem_truncate on public.audit_log;
  drop trigger if exists trg_carimbar_ip_auditoria on public.audit_log;
  alter table public.audit_log drop column if exists ip, drop column if exists ip_cliente;
  drop function if exists public.carimbar_ip_auditoria();
  drop function if exists public.bloquear_alteracao_registro();

  delete from public.pending_decisions where chave in (select chave from _op4_pendencias);
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

  create temp table _fp_depois on commit drop as select item from pg_temp.fp_schema_base();

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: etapa 4 aplicada, verificada, testada (T1 a T12) e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
drop function if exists pg_temp.fp_schema_base();
notify pgrst, 'reload schema';

commit;
