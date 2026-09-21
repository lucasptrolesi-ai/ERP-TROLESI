-- Etapa 3 do modulo de varejo: fundacao.
-- Pre-requisito: etapas 1 e 2 aplicadas (operacao_atual, carimbar_operacao, travar_operacao).
--
-- O QUE FAZ (uma transacao so), tudo NOVO e do varejo; o atacado nao e tocado:
--   1. arredondar_moeda(): UNICA funcao de arredondamento monetario do sistema (HALF_UP: empate
--      afasta do zero). Todo dinheiro novo e numeric(12,2).
--   2. parametros_multiplicador + multiplicador_vigente(): o multiplicador de atacado (2,8) vive em
--      tabela com vigencia, sem sobreposicao. So a rotina de transferencia (etapa 5) chama
--      multiplicador_vigente(); ele nao e executavel por usuario nenhum do app.
--   3. catalogo_produtos (pai) + catalogo_variacoes (grade tamanho/cor/numeracao): produto sem
--      variacao nao existe (constraint deferida). Joia = um pai com uma variacao. Sem custo aqui.
--   4. estoque_movimentos: APPEND-ONLY (UPDATE/DELETE/TRUNCATE bloqueados por trigger e sem
--      privilegio). Saldo e agregacao (view estoque_saldos). custo_unitario e gravado no fato e e
--      obrigatorio. Ninguem grava direto: so as functions registrar_entrada_estoque e
--      registrar_ajuste_estoque (auditadas). Vendedor nao le custo: le apenas as views
--      estoque_saldos e pdv_catalogo, que nao tem coluna de custo.
--   5. Auditoria de alteracao de preco (catalogo_variacoes).
--   6. Sementes do VAREJO: deposito LOJA, caixa CAIXA 1, multiplicador 2,8.
--
-- O atacado segue no modelo antigo (produtos.quantidade_estoque mutavel, multiplicador por produto):
-- registrado em pending_decisions para migrar depois da etapa 5.
--
-- COMO RODAR: igual as etapas anteriores. Modo padrao 'ensaio' (aplica, verifica, testa como cada
-- usuario, desfaz e compara o schema; termina com "ENSAIO OK", nada e gravado). Depois 'aplicar'.
-- ROLLBACK: modo 'desfazer'.

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

create temp table _op3_pendencias (chave text primary key, descricao text not null) on commit drop;

insert into _op3_pendencias (chave, descricao) values
  ('metodo_custo_varejo',
   'Custo de saida do varejo = custo medio das entradas da variacao (custo_medio_variacao), copiado para o movimento e para a linha da venda no momento do fato. Confirmar com o contador se o metodo (medio x PEPS) e o desejado.'),
  ('multiplicador_legado_produtos',
   'O atacado ainda usa produtos.multiplicador (default 2,8) e calcula preco no cliente (novo-pedido.tsx, venda-por-foto-view.tsx, precificacao.ts). A regra 7 exige que so a rotina de transferencia conheca o multiplicador (parametros_multiplicador): migrar o atacado depois da etapa 5.'),
  ('estoque_atacado_legado',
   'O estoque do atacado segue em produtos.quantidade_estoque (coluna mutavel) + movimentos_estoque sem custo. O varejo ja nasce em estoque_movimentos append-only com custo_unitario. Migrar o atacado para o mesmo modelo (saldo inicial por movimento) e remover a coluna mutavel.'),
  ('estoque_varejo_sem_saldo_negativo',
   'registrar_ajuste_estoque recusa saida que deixaria o saldo negativo (o atacado permite estoque negativo autorizado). Confirmar se o varejo deve permitir.');

create temp table _op_contagens_antes (tabela text primary key, n bigint not null) on commit drop;

do $lock$
declare
  v_n bigint;
begin
  lock table public.depositos in access exclusive mode;
  lock table public.caixas in access exclusive mode;
  lock table public.pending_decisions in access exclusive mode;
  select count(*) into v_n from public.depositos;
  insert into _op_contagens_antes values ('depositos', v_n);
  select count(*) into v_n from public.caixas;
  insert into _op_contagens_antes values ('caixas', v_n);
end $lock$;

create or replace function pg_temp.fp_schema() returns table(item text) language sql as $f$
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
  select 'S depositos ' || count(*) from public.depositos
  union all
  select 'S caixas ' || count(*) from public.caixas
$f$;

create temp table _fp_antes on commit drop as select item from pg_temp.fp_schema();

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_varejo uuid;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.carimbar_operacao()') is null then
    raise exception 'ABORTADO: etapa 2 nao aplicada (carimbar_operacao ausente).';
  end if;
  if to_regclass('public.estoque_movimentos') is not null then
    raise exception 'ABORTADO: etapa 3 parece ja aplicada (estoque_movimentos existe).';
  end if;
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  if v_varejo is null then
    raise exception 'ABORTADO: operacao VAREJO ausente.';
  end if;

  -- 1. Dinheiro: unica funcao de arredondamento ----------------------------------------------------
  create or replace function public.arredondar_moeda(p_valor numeric) returns numeric
  language sql immutable parallel safe as $fn$
    select round(p_valor, 2)
  $fn$;

  -- 2. Multiplicador com vigencia --------------------------------------------------------------------
  create table public.parametros_multiplicador (
    id uuid primary key default gen_random_uuid(),
    chave text not null,
    valor numeric(8, 4) not null check (valor > 0),
    vigente_de date not null,
    vigente_ate date,
    criado_por uuid references public.profiles (id),
    criado_em timestamptz not null default now(),
    constraint parametros_multiplicador_vigencia check (vigente_ate is null or vigente_ate >= vigente_de)
  );
  create index parametros_multiplicador_chave_idx on public.parametros_multiplicador (chave, vigente_de);

  create or replace function public.validar_vigencia_multiplicador() returns trigger
  language plpgsql as $fn$
  begin
    if exists (select 1 from public.parametros_multiplicador x
                where x.chave = new.chave and x.id <> new.id
                  and daterange(x.vigente_de, coalesce(x.vigente_ate, date '9999-12-31'), '[]')
                      && daterange(new.vigente_de, coalesce(new.vigente_ate, date '9999-12-31'), '[]')) then
      raise exception 'Vigencia sobreposta para o parametro %', new.chave using errcode = '23514';
    end if;
    return new;
  end
  $fn$;
  create trigger trg_vigencia_multiplicador before insert or update on public.parametros_multiplicador
    for each row execute function public.validar_vigencia_multiplicador();

  create or replace function public.multiplicador_vigente(p_chave text, p_data date default current_date) returns numeric
  language plpgsql stable security definer set search_path = public as $fn$
  declare
    v_valor numeric;
  begin
    select p.valor into v_valor from public.parametros_multiplicador p
     where p.chave = p_chave and p.vigente_de <= p_data and (p.vigente_ate is null or p.vigente_ate >= p_data)
     order by p.vigente_de desc limit 1;
    if v_valor is null then
      raise exception 'Sem multiplicador vigente para % em %', p_chave, p_data;
    end if;
    return v_valor;
  end
  $fn$;
  revoke execute on function public.multiplicador_vigente(text, date) from public, anon, authenticated;

  alter table public.parametros_multiplicador enable row level security;
  create policy "admin gerencia parametros_multiplicador" on public.parametros_multiplicador for all to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario)
    with check (public.meu_papel() = 'admin'::public.papel_usuario);
  revoke all on public.parametros_multiplicador from anon;
  grant select, insert, update, delete on public.parametros_multiplicador to authenticated;

  -- 3. Catalogo: pai + variacao ----------------------------------------------------------------------
  create table public.catalogo_produtos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    nome text not null,
    categoria text,
    descricao text,
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint catalogo_produtos_id_operacao_key unique (id, operacao_id)
  );
  create index catalogo_produtos_operacao_id_idx on public.catalogo_produtos (operacao_id);

  create table public.catalogo_variacoes (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    produto_id uuid not null,
    sku text not null,
    codigo_barras text,
    atributos jsonb not null default '{}'::jsonb,
    preco_venda numeric(12, 2) not null check (preco_venda >= 0),
    preco_minimo numeric(12, 2) check (preco_minimo is null or (preco_minimo >= 0 and preco_minimo <= preco_venda)),
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint catalogo_variacoes_id_operacao_key unique (id, operacao_id),
    constraint catalogo_variacoes_operacao_sku_key unique (operacao_id, sku),
    constraint catalogo_variacoes_produto_op_fkey foreign key (produto_id, operacao_id)
      references public.catalogo_produtos (id, operacao_id)
  );
  create index catalogo_variacoes_operacao_id_idx on public.catalogo_variacoes (operacao_id);
  create index catalogo_variacoes_produto_id_idx on public.catalogo_variacoes (produto_id);
  create unique index catalogo_variacoes_operacao_barras_key on public.catalogo_variacoes (operacao_id, codigo_barras) where codigo_barras is not null;

  create trigger catalogo_produtos_atualizado_em before update on public.catalogo_produtos for each row execute function public.set_atualizado_em();
  create trigger catalogo_variacoes_atualizado_em before update on public.catalogo_variacoes for each row execute function public.set_atualizado_em();

  create or replace function public.exigir_variacao_no_produto() returns trigger
  language plpgsql as $fn$
  begin
    if not exists (select 1 from public.catalogo_variacoes v where v.produto_id = new.id) then
      raise exception 'Produto sem variacao nao existe: cadastre ao menos uma variacao (joia = uma variacao)' using errcode = '23514';
    end if;
    return null;
  end
  $fn$;
  create constraint trigger trg_produto_exige_variacao after insert on public.catalogo_produtos
    deferrable initially deferred for each row execute function public.exigir_variacao_no_produto();

  create or replace function public.exigir_variacao_restante() returns trigger
  language plpgsql as $fn$
  begin
    if exists (select 1 from public.catalogo_produtos p where p.id = old.produto_id)
       and not exists (select 1 from public.catalogo_variacoes v where v.produto_id = old.produto_id) then
      raise exception 'Nao e possivel remover a ultima variacao do produto' using errcode = '23514';
    end if;
    return null;
  end
  $fn$;
  create constraint trigger trg_produto_mantem_variacao after delete on public.catalogo_variacoes
    deferrable initially deferred for each row execute function public.exigir_variacao_restante();

  create or replace function public.auditar_alteracao_preco() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if new.preco_venda is distinct from old.preco_venda or new.preco_minimo is distinct from old.preco_minimo then
      perform public.registrar_auditoria('catalogo_variacoes', new.id, 'alteracao_preco',
        jsonb_build_object('preco_venda', old.preco_venda, 'preco_minimo', old.preco_minimo),
        jsonb_build_object('preco_venda', new.preco_venda, 'preco_minimo', new.preco_minimo), null);
    end if;
    return new;
  end
  $fn$;
  create trigger trg_auditar_preco after update on public.catalogo_variacoes
    for each row execute function public.auditar_alteracao_preco();

  -- 4. Estoque append-only -----------------------------------------------------------------------------
  create table public.estoque_movimentos (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    deposito_id uuid not null,
    variacao_id uuid not null,
    tipo text not null check (tipo in ('entrada', 'venda', 'ajuste', 'transferencia_entrada', 'transferencia_saida', 'devolucao_venda')),
    quantidade integer not null check (quantidade <> 0),
    custo_unitario numeric(12, 2) not null check (custo_unitario >= 0),
    documento_tipo text,
    documento_id uuid,
    observacao text,
    criado_por uuid references public.profiles (id),
    criado_em timestamptz not null default now(),
    constraint estoque_movimentos_sinal check (
      (tipo in ('entrada', 'transferencia_entrada', 'devolucao_venda') and quantidade > 0)
      or (tipo in ('venda', 'transferencia_saida') and quantidade < 0)
      or tipo = 'ajuste'),
    constraint estoque_movimentos_deposito_op_fkey foreign key (deposito_id, operacao_id)
      references public.depositos (id, operacao_id),
    constraint estoque_movimentos_variacao_op_fkey foreign key (variacao_id, operacao_id)
      references public.catalogo_variacoes (id, operacao_id)
  );
  create index estoque_movimentos_operacao_id_idx on public.estoque_movimentos (operacao_id);
  create index estoque_movimentos_variacao_idx on public.estoque_movimentos (variacao_id, deposito_id);

  create or replace function public.bloquear_alteracao_movimento() returns trigger
  language plpgsql as $fn$
  begin
    raise exception 'estoque_movimentos e append-only: corrija com um movimento de ajuste' using errcode = '55000';
  end
  $fn$;
  create trigger trg_movimento_append_only before update or delete on public.estoque_movimentos
    for each row execute function public.bloquear_alteracao_movimento();
  create trigger trg_movimento_sem_truncate before truncate on public.estoque_movimentos
    for each statement execute function public.bloquear_alteracao_movimento();

  -- Carimbo de operacao + politica restritiva (mesmo padrao da etapa 2) nas 3 tabelas por operacao
  create trigger trg_carimbar_operacao before insert on public.catalogo_produtos for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.catalogo_produtos for each row execute function public.travar_operacao();
  create trigger trg_carimbar_operacao before insert on public.catalogo_variacoes for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.catalogo_variacoes for each row execute function public.travar_operacao();
  create trigger trg_carimbar_operacao before insert on public.estoque_movimentos for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.estoque_movimentos for each row execute function public.travar_operacao();

  alter table public.catalogo_produtos enable row level security;
  alter table public.catalogo_variacoes enable row level security;
  alter table public.estoque_movimentos enable row level security;

  create policy "escopo de operacao" on public.catalogo_produtos as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.catalogo_variacoes as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));
  create policy "escopo de operacao" on public.estoque_movimentos as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));

  create policy "time logado le catalogo_produtos" on public.catalogo_produtos for select to authenticated
    using (public.meu_papel() is not null);
  create policy "admin e estoque gerenciam catalogo_produtos" on public.catalogo_produtos for all to authenticated
    using (public.meu_papel() = any (array['admin', 'estoque']::public.papel_usuario[]))
    with check (public.meu_papel() = any (array['admin', 'estoque']::public.papel_usuario[]));
  create policy "time logado le catalogo_variacoes" on public.catalogo_variacoes for select to authenticated
    using (public.meu_papel() is not null);
  create policy "admin e estoque gerenciam catalogo_variacoes" on public.catalogo_variacoes for all to authenticated
    using (public.meu_papel() = any (array['admin', 'estoque']::public.papel_usuario[]))
    with check (public.meu_papel() = any (array['admin', 'estoque']::public.papel_usuario[]));
  -- Movimentos: so o admin le (tem custo). Ninguem grava direto (ver revoke abaixo).
  create policy "admin le estoque_movimentos" on public.estoque_movimentos for select to authenticated
    using (public.meu_papel() = 'admin'::public.papel_usuario);

  revoke all on public.catalogo_produtos, public.catalogo_variacoes, public.estoque_movimentos from anon;
  revoke all on public.estoque_movimentos from authenticated;
  grant select on public.estoque_movimentos to authenticated;
  grant select, insert, update, delete on public.catalogo_produtos, public.catalogo_variacoes to authenticated;

  -- Views sem custo (rodam como dono, entao filtram a operacao da sessao explicitamente)
  create view public.estoque_saldos as
    select m.operacao_id, m.deposito_id, m.variacao_id, sum(m.quantidade)::integer as saldo
      from public.estoque_movimentos m
     where m.operacao_id = (select public.operacao_atual())
     group by m.operacao_id, m.deposito_id, m.variacao_id;

  create view public.pdv_catalogo as
    select v.id as variacao_id, v.operacao_id, p.id as produto_id, p.nome, p.categoria, v.sku, v.codigo_barras,
           v.atributos, v.preco_venda,
           coalesce((select sum(m.quantidade) from public.estoque_movimentos m
                      where m.variacao_id = v.id and m.operacao_id = v.operacao_id), 0)::integer as saldo
      from public.catalogo_variacoes v
      join public.catalogo_produtos p on p.id = v.produto_id and p.operacao_id = v.operacao_id
     where v.ativo and p.ativo and v.operacao_id = (select public.operacao_atual());

  revoke all on public.estoque_saldos, public.pdv_catalogo from anon, authenticated;
  grant select on public.estoque_saldos, public.pdv_catalogo to authenticated;

  -- 5. Funcoes de estoque (unico caminho de escrita) ----------------------------------------------------
  create or replace function public.custo_medio_variacao(p_variacao_id uuid) returns numeric
  language sql stable security definer set search_path = public as $fn$
    select public.arredondar_moeda(sum(m.quantidade * m.custo_unitario) / nullif(sum(m.quantidade), 0))
      from public.estoque_movimentos m
     where m.variacao_id = p_variacao_id and m.quantidade > 0 and m.operacao_id = public.operacao_atual()
  $fn$;
  revoke execute on function public.custo_medio_variacao(uuid) from public, anon, authenticated;

  create or replace function public.registrar_entrada_estoque(
    p_deposito_id uuid, p_variacao_id uuid, p_quantidade integer, p_custo_unitario numeric, p_observacao text default null
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_id uuid;
    v_custo numeric;
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    if p_quantidade is null or p_quantidade <= 0 then
      raise exception 'Quantidade deve ser maior que zero';
    end if;
    if p_custo_unitario is null or p_custo_unitario < 0 then
      raise exception 'Custo unitario e obrigatorio e nao pode ser negativo';
    end if;
    v_custo := public.arredondar_moeda(p_custo_unitario);
    insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, observacao, criado_por)
    values (p_deposito_id, p_variacao_id, 'entrada', p_quantidade, v_custo, p_observacao, auth.uid())
    returning id into v_id;
    perform public.registrar_auditoria('estoque_movimentos', v_id, 'entrada_estoque', null,
      jsonb_build_object('deposito_id', p_deposito_id, 'variacao_id', p_variacao_id, 'quantidade', p_quantidade, 'custo_unitario', v_custo),
      p_observacao);
    return v_id;
  end
  $fn$;

  create or replace function public.registrar_ajuste_estoque(
    p_deposito_id uuid, p_variacao_id uuid, p_quantidade integer, p_justificativa text, p_custo_unitario numeric default null
  ) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_id uuid;
    v_custo numeric;
    v_saldo bigint;
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    if p_quantidade is null or p_quantidade = 0 then
      raise exception 'Quantidade do ajuste nao pode ser zero';
    end if;
    if p_justificativa is null or length(trim(p_justificativa)) = 0 then
      raise exception 'Justificativa e obrigatoria em ajuste de estoque';
    end if;
    if p_quantidade < 0 then
      v_custo := public.custo_medio_variacao(p_variacao_id);
      select coalesce(sum(m.quantidade), 0) into v_saldo from public.estoque_movimentos m
       where m.variacao_id = p_variacao_id and m.deposito_id = p_deposito_id and m.operacao_id = public.operacao_atual();
      if v_saldo + p_quantidade < 0 then
        raise exception 'Saldo insuficiente para o ajuste (saldo %, ajuste %)', v_saldo, p_quantidade;
      end if;
    else
      v_custo := coalesce(public.arredondar_moeda(p_custo_unitario), public.custo_medio_variacao(p_variacao_id));
    end if;
    if v_custo is null then
      raise exception 'Sem custo conhecido para a variacao: informe o custo unitario';
    end if;
    insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario, observacao, criado_por)
    values (p_deposito_id, p_variacao_id, 'ajuste', p_quantidade, v_custo, p_justificativa, auth.uid())
    returning id into v_id;
    perform public.registrar_auditoria('estoque_movimentos', v_id, 'ajuste_estoque', null,
      jsonb_build_object('deposito_id', p_deposito_id, 'variacao_id', p_variacao_id, 'quantidade', p_quantidade, 'custo_unitario', v_custo),
      p_justificativa);
    return v_id;
  end
  $fn$;

  revoke execute on function public.registrar_entrada_estoque(uuid, uuid, integer, numeric, text) from public, anon, authenticated;
  revoke execute on function public.registrar_ajuste_estoque(uuid, uuid, integer, text, numeric) from public, anon, authenticated;
  grant execute on function public.registrar_entrada_estoque(uuid, uuid, integer, numeric, text) to authenticated;
  grant execute on function public.registrar_ajuste_estoque(uuid, uuid, integer, text, numeric) to authenticated;

  -- 6. Sementes ---------------------------------------------------------------------------------------
  insert into public.depositos (operacao_id, nome, tipo) values (v_varejo, 'LOJA', 'loja');
  insert into public.caixas (operacao_id, nome) values (v_varejo, 'CAIXA 1');
  insert into public.parametros_multiplicador (chave, valor, vigente_de)
  values ('TRANSFERENCIA_ATACADO_VAREJO', 2.8, date '2000-01-01');

  insert into public.pending_decisions (chave, descricao, ativo)
  select chave, descricao, false from _op3_pendencias;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_n bigint;
  v_m bigint;
  v_antes bigint;
begin
  if v_modo not in ('ensaio', 'aplicar') then
    return;
  end if;

  select n into v_antes from _op_contagens_antes where tabela = 'depositos';
  select count(*) into v_n from public.depositos;
  if v_n <> v_antes + 1 then raise exception 'FALHA: depositos = %, esperado %', v_n, v_antes + 1; end if;
  select n into v_antes from _op_contagens_antes where tabela = 'caixas';
  select count(*) into v_n from public.caixas;
  if v_n <> v_antes + 1 then raise exception 'FALHA: caixas = %, esperado %', v_n, v_antes + 1; end if;

  select count(*) into v_n from pg_policies where schemaname = 'public' and policyname = 'escopo de operacao' and permissive = 'RESTRICTIVE'
     and tablename in ('catalogo_produtos', 'catalogo_variacoes', 'estoque_movimentos');
  if v_n <> 3 then raise exception 'FALHA: politicas restritivas novas = %, esperado 3', v_n; end if;

  select count(*) into v_n from pg_trigger where not tgisinternal and tgname = 'trg_carimbar_operacao'
     and tgrelid in ('public.catalogo_produtos'::regclass, 'public.catalogo_variacoes'::regclass, 'public.estoque_movimentos'::regclass);
  if v_n <> 3 then raise exception 'FALHA: triggers de carimbo novos = %, esperado 3', v_n; end if;

  select count(*) into v_n from pg_trigger where not tgisinternal and tgrelid = 'public.estoque_movimentos'::regclass
     and tgname in ('trg_movimento_append_only', 'trg_movimento_sem_truncate');
  if v_n <> 2 then raise exception 'FALHA: triggers append-only = %, esperado 2', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name in ('pdv_catalogo', 'estoque_saldos') and column_name ilike '%custo%';
  if v_n <> 0 then raise exception 'FALHA: as views do PDV expoem % colunas de custo', v_n; end if;

  select count(*) into v_n from public.parametros_multiplicador where chave = 'TRANSFERENCIA_ATACADO_VAREJO';
  if v_n <> 1 then raise exception 'FALHA: multiplicador semeado = %, esperado 1', v_n; end if;

  select count(*) into v_n from public.pending_decisions where chave in (select chave from _op3_pendencias);
  select count(*) into v_m from _op3_pendencias;
  if v_n <> v_m then raise exception 'FALHA: pendencias = %, esperado %', v_n, v_m; end if;

  raise notice 'VERIFICACAO OK: catalogo pai+variacao, estoque append-only, views sem custo, multiplicador com vigencia, sementes.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_atacado uuid;
  v_varejo uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_barbara uuid := 'c68a61de-5fd0-4191-bf88-a64eff0b7964';
  v_dep uuid;
  v_prod uuid;
  v_var uuid;
  v_mov uuid;
  v_n bigint;
  v_x numeric;
  v_ok boolean;
begin
  if v_modo <> 'ensaio' then
    return;
  end if;

  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_dep from public.depositos where operacao_id = v_varejo and nome = 'LOJA';

  -- T1. Arredondamento HALF_UP (empate afasta do zero)
  if public.arredondar_moeda(1.005) <> 1.01 or public.arredondar_moeda(-1.005) <> -1.01
     or public.arredondar_moeda(2.675) <> 2.68 or public.arredondar_moeda(0.004) <> 0 then
    raise exception 'TESTE FALHOU [T1 arredondamento HALF_UP]';
  end if;

  -- T2. Multiplicador com vigencia: le o vigente; sobreposicao e rejeitada
  v_x := public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO', current_date);
  if v_x <> 2.8 then raise exception 'TESTE FALHOU [T2]: multiplicador vigente = %, esperado 2.8', v_x; end if;
  begin
    insert into public.parametros_multiplicador (chave, valor, vigente_de) values ('TRANSFERENCIA_ATACADO_VAREJO', 3.0, current_date);
    raise exception 'TESTE FALHOU [T2]: vigencia sobreposta foi aceita';
  exception when check_violation then
    null;
  end;

  -- T3. Lucas em contexto VAREJO: cria produto pai + variacao
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';
  insert into public.catalogo_produtos (nome, categoria) values ('ZZ ENSAIO ANEL', 'ANEL') returning id into v_prod;
  insert into public.catalogo_variacoes (produto_id, sku, atributos, preco_venda, preco_minimo)
  values (v_prod, 'ZZENSAIO-16', '{"numeracao": "16"}'::jsonb, 100.00, 80.00) returning id into v_var;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';

  -- T4. Produto sem variacao nao existe
  begin
    insert into public.catalogo_produtos (nome) values ('ZZ ENSAIO SEM VARIACAO');
    execute 'set constraints all immediate';
    raise exception 'TESTE FALHOU [T4]: produto sem variacao foi aceito';
  exception when check_violation then
    null;
  end;
  execute 'set constraints all deferred';

  -- T5. Entrada de estoque: custo congelado com HALF_UP; saldo e agregacao
  v_mov := public.registrar_entrada_estoque(v_dep, v_var, 10, 12.345, 'ensaio');
  select saldo into v_n from public.estoque_saldos where variacao_id = v_var;
  if v_n is distinct from 10 then raise exception 'TESTE FALHOU [T5]: saldo = %, esperado 10', v_n; end if;
  select custo_unitario into v_x from public.estoque_movimentos where id = v_mov;
  if v_x is distinct from 12.35 then raise exception 'TESTE FALHOU [T5]: custo gravado = %, esperado 12.35', v_x; end if;

  -- T6. Append-only: sem privilegio para o usuario; trigger barra ate o dono
  begin
    execute format('update public.estoque_movimentos set quantidade = 99 where id = %L', v_mov);
    raise exception 'TESTE FALHOU [T6]: UPDATE direto foi aceito';
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute format('delete from public.estoque_movimentos where id = %L', v_mov);
    raise exception 'TESTE FALHOU [T6]: DELETE direto foi aceito';
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute format('insert into public.estoque_movimentos (deposito_id, variacao_id, tipo, quantidade, custo_unitario) values (%L, %L, %L, 5, 1)', v_dep, v_var, 'entrada');
    raise exception 'TESTE FALHOU [T6]: INSERT direto em estoque_movimentos foi aceito';
  exception when insufficient_privilege then
    null;
  end;

  -- T7. Ajuste: exige justificativa, recusa saldo negativo, custo = custo medio congelado no fato
  v_ok := false;
  begin
    perform public.registrar_ajuste_estoque(v_dep, v_var, -1, '  ');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: ajuste sem justificativa foi aceito'; end if;
  v_ok := false;
  begin
    perform public.registrar_ajuste_estoque(v_dep, v_var, -50, 'quebra');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T7]: ajuste que deixa saldo negativo foi aceito'; end if;
  v_mov := public.registrar_ajuste_estoque(v_dep, v_var, -3, 'quebra de peca');
  select saldo into v_n from public.estoque_saldos where variacao_id = v_var;
  if v_n is distinct from 7 then raise exception 'TESTE FALHOU [T7]: saldo apos ajuste = %, esperado 7', v_n; end if;

  -- T8. Alteracao de preco e auditada
  update public.catalogo_variacoes set preco_venda = 110.00 where id = v_var;
  execute 'reset role';
  select count(*) into v_n from public.audit_log where tabela = 'catalogo_variacoes' and acao = 'alteracao_preco' and registro_id = v_var;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T8]: auditorias de preco = %, esperado 1', v_n; end if;
  select count(*) into v_n from public.audit_log where tabela = 'estoque_movimentos' and acao in ('entrada_estoque', 'ajuste_estoque');
  if v_n <> 2 then raise exception 'TESTE FALHOU [T8]: auditorias de estoque = %, esperado 2', v_n; end if;

  -- Como dono, o trigger tambem barra UPDATE/DELETE
  v_ok := false;
  begin
    update public.estoque_movimentos set quantidade = 99 where id = v_mov;
  exception when object_not_in_prerequisite_state then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T6b]: trigger append-only nao barrou UPDATE do dono'; end if;

  -- T9. Isolamento: Lucas em contexto ATACADO nao ve o catalogo nem o estoque do VAREJO
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.catalogo_produtos;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T9]: contexto ATACADO viu % produtos do varejo', v_n; end if;
  select count(*) into v_n from public.estoque_saldos;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T9]: contexto ATACADO viu % saldos do varejo', v_n; end if;
  execute 'reset role';

  -- T10. Vendedora so do VAREJO (simulada nesta transacao): ve preco e saldo, nao ve custo nem o atacado
  update public.operacoes set ativo = true where id = v_varejo;
  delete from public.usuario_operacoes where profile_id = v_barbara and operacao_id = v_atacado;
  insert into public.usuario_operacoes (profile_id, operacao_id, padrao) values (v_barbara, v_varejo, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_barbara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.estoque_movimentos;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T10]: vendedora do varejo leu % movimentos (tem custo)', v_n; end if;
  select saldo into v_n from public.pdv_catalogo where variacao_id = v_var;
  if v_n is distinct from 7 then raise exception 'TESTE FALHOU [T10]: saldo no PDV = %, esperado 7', v_n; end if;
  select preco_venda into v_x from public.pdv_catalogo where variacao_id = v_var;
  if v_x is distinct from 110.00 then raise exception 'TESTE FALHOU [T10]: preco no PDV = %, esperado 110', v_x; end if;
  select count(*) into v_n from public.pedidos;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T10]: vendedora do varejo viu % pedidos do atacado', v_n; end if;
  v_ok := false;
  begin
    insert into public.catalogo_produtos (nome) values ('ZZ NAO PODE');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T10]: vendedora criou produto no catalogo'; end if;
  v_ok := false;
  begin
    perform public.registrar_entrada_estoque(v_dep, v_var, 1, 1);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T10]: vendedora registrou entrada de estoque'; end if;
  v_ok := false;
  begin
    perform public.multiplicador_vigente('TRANSFERENCIA_ATACADO_VAREJO');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  if not v_ok then raise exception 'TESTE FALHOU [T10]: usuario do app conseguiu ler o multiplicador'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T10 (HALF_UP, vigencia, pai+variacao, custo congelado, append-only, auditoria, isolamento, vendedora sem custo).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
declare
  v_modo text := coalesce(current_setting('app.modo_migration', true), '');
  v_varejo uuid;
begin
  if v_modo not in ('ensaio', 'desfazer') then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';

  drop view if exists public.pdv_catalogo;
  drop view if exists public.estoque_saldos;
  drop table if exists public.estoque_movimentos, public.catalogo_variacoes, public.catalogo_produtos, public.parametros_multiplicador;

  drop function if exists public.registrar_ajuste_estoque(uuid, uuid, integer, text, numeric);
  drop function if exists public.registrar_entrada_estoque(uuid, uuid, integer, numeric, text);
  drop function if exists public.custo_medio_variacao(uuid);
  drop function if exists public.bloquear_alteracao_movimento();
  drop function if exists public.auditar_alteracao_preco();
  drop function if exists public.exigir_variacao_restante();
  drop function if exists public.exigir_variacao_no_produto();
  drop function if exists public.multiplicador_vigente(text, date);
  drop function if exists public.validar_vigencia_multiplicador();
  drop function if exists public.arredondar_moeda(numeric);

  delete from public.caixas where operacao_id = v_varejo and nome = 'CAIXA 1';
  delete from public.depositos where operacao_id = v_varejo and nome = 'LOJA';
  delete from public.pending_decisions where chave in (select chave from _op3_pendencias);
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

  create temp table _fp_depois on commit drop as select item from pg_temp.fp_schema();

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o schema ao estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: etapa 3 aplicada, verificada, testada (T1 a T10) e desfeita com o schema identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
drop function if exists pg_temp.fp_schema();
notify pgrst, 'reload schema';

commit;
