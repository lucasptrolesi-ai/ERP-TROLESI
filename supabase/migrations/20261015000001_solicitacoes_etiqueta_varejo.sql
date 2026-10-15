-- Etiqueta de joia 95x12mm (Elgin L42 Pro Full), impressao a partir do cadastro no Varejo (plano do
-- usuario, 2026-10-15) -- mesmo padrao de solicitacoes_impressao (cupom termico): o navegador grava
-- o pedido aqui, o print-agent (rodando na Mac da loja, ligado na Elgin) consome e imprime de
-- verdade via ZPL/CUPS raw.
--
-- Historico (ver migrations 20260814000001/20260817000001/20260825000001/20260825000002 e
-- commits 265a3f0/4f84ef5/1a32709/2c0ef2b/9be0d69): esta MESMA ideia -- fila de etiqueta consumida
-- pelo print-agent -- ja foi tentada duas vezes com uma Argox OS-214TT e abandonada as duas, por
-- protocolo PPLA/EPL2 cru nunca sair confiavel (etiqueta em branco, dado vazando pra etiqueta
-- vizinha, dimensao real nunca confirmada com certeza -- testes com 44mm/43mm/41.63mm/95mm todos
-- inconsistentes). NAO e o mesmo caso: impressora diferente (Elgin L42 Pro Full, generica, nao a
-- Argox), protocolo ZPL (nao PPLA/EPL2), geometria MEDIDA com regua na etiqueta fisica real e o ZPL
-- ja validado no papel antes desta migration existir (ver DECISIONS.md). O ^GFA do QR (bitmap, nao
-- o comando nativo ^BQ) tambem e uma licao direta do historico: ^BQ sai ~4mm deslocado pra baixo e
-- corta na base nesta impressora -- descoberto testando fisicamente, nao suposto.
--
-- Diferenca de schema em relacao a tentativa anterior (solicitacoes_etiqueta original, pre
-- multi-operacao): esta tabela ja nasce com operacao_id (carimbar_operacao/travar_operacao), porque
-- a arquitetura de operacoes (20260921000001) nao existia ainda da ultima vez. Os grants seguem o
-- padrao mais novo e mais estrito (revoke all + grant minimo, 20261008000001) em vez do grant mais
-- solto que solicitacoes_impressao tinha originalmente -- nao copiado de proposito.
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
select set_config('app.modo_migration', 'ensaio', true);
set local lock_timeout = '15s';

do $modo$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar', 'desfazer') then
    raise exception 'Modo invalido em app.modo_migration (use ensaio, aplicar ou desfazer).';
  end if;
  raise notice 'Modo: %', current_setting('app.modo_migration', true);
end $modo$;

create temp table _fp_antes on commit drop as
  select 'TAB ' || t.table_name as item from information_schema.tables t
   where t.table_schema = 'public' and t.table_name = 'solicitacoes_etiqueta';

-- APLICAR (modos ensaio e aplicar) --------------------------------------------------------------

do $up$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  create table public.solicitacoes_etiqueta (
    id uuid primary key default gen_random_uuid(),
    operacao_id uuid not null references public.operacoes (id),
    produto_id uuid not null references public.catalogo_produtos (id),
    variacao_id uuid not null references public.catalogo_variacoes (id),
    linha1 text not null check (char_length(linha1) <= 20),
    preco text not null check (char_length(preco) <= 20),
    linha3 text not null default '' check (char_length(linha3) <= 20),
    codigo text not null check (char_length(codigo) between 1 and 8),
    quantidade integer not null check (quantidade between 1 and 999),
    status text not null default 'pendente' check (status in ('pendente', 'impresso', 'erro')),
    erro text,
    criado_por uuid not null default auth.uid() references public.profiles (id),
    criado_em timestamptz not null default now(),
    impresso_em timestamptz
  );

  -- Mesmo indice parcial de solicitacoes_impressao -- o print-agent roda essa consulta
  -- (status='pendente') a cada ~2s pra sempre; sem o indice, vira full table scan conforme a fila
  -- acumula meses de cadastro de peca.
  create index solicitacoes_etiqueta_pendentes_idx
    on public.solicitacoes_etiqueta (criado_em)
    where (status = 'pendente');
  create index solicitacoes_etiqueta_variacao_idx on public.solicitacoes_etiqueta (variacao_id);

  create trigger trg_carimbar_operacao before insert on public.solicitacoes_etiqueta for each row execute function public.carimbar_operacao();
  create trigger trg_travar_operacao before update of operacao_id on public.solicitacoes_etiqueta for each row execute function public.travar_operacao();

  alter table public.solicitacoes_etiqueta enable row level security;

  create policy "escopo de operacao" on public.solicitacoes_etiqueta as restrictive for all to public
    using (operacao_id = (select public.operacao_atual())) with check (operacao_id = (select public.operacao_atual()));

  -- Mesmos papeis que ja cadastram peca no catalogo do Varejo (ver cadastrar_produto_catalogo,
  -- 20260929000001) -- o preco impresso na etiqueta ja e publico na propria lista do catalogo pra
  -- quem tem acesso a tela (so o CUSTO/margem e admin-only, nao a etiqueta).
  create policy "admin e estoque criam solicitacao de etiqueta" on public.solicitacoes_etiqueta for insert to authenticated
    with check (public.meu_papel() in ('admin'::public.papel_usuario, 'estoque'::public.papel_usuario));
  create policy "admin e estoque leem solicitacoes de etiqueta" on public.solicitacoes_etiqueta for select to authenticated
    using (public.meu_papel() in ('admin'::public.papel_usuario, 'estoque'::public.papel_usuario));

  -- Sem policy de update/delete pro app de proposito -- so o print-agent (service_role, bypassa RLS)
  -- marca como impresso/erro, mesmo espirito de solicitacoes_impressao.
  revoke all on public.solicitacoes_etiqueta from anon, public, authenticated;
  grant select, insert on public.solicitacoes_etiqueta to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regclass('public.solicitacoes_etiqueta') is null then
    raise exception 'FALHA: solicitacoes_etiqueta nao existe';
  end if;
  if not (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'solicitacoes_etiqueta') then
    raise exception 'FALHA: solicitacoes_etiqueta sem RLS ligada';
  end if;
  if has_table_privilege('authenticated', 'public.solicitacoes_etiqueta', 'UPDATE') then
    raise exception 'FALHA: authenticated nao deveria conseguir UPDATE (so o print-agent, via service_role)';
  end if;
  if has_table_privilege('anon', 'public.solicitacoes_etiqueta', 'SELECT') then
    raise exception 'FALHA: anon com select em solicitacoes_etiqueta';
  end if;

  raise notice 'VERIFICACAO OK: tabela, indices, RLS e grants no lugar.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_atacado uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_vendedor uuid;
  v_estoque uuid;
  v_prod uuid;
  v_var uuid;
  v_sol uuid;
  v_n bigint;
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  select id into v_varejo from public.operacoes where codigo = 'VAREJO';
  select id into v_atacado from public.operacoes where codigo = 'ATACADO';
  select id into v_vendedor from public.profiles where papel = 'vendedor' limit 1;
  select id into v_estoque from public.profiles where papel = 'estoque' limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  execute 'set local role authenticated';

  v_prod := public.cadastrar_produto_catalogo('ZZ ENSAIO ETIQUETA', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZ001', 'atributos', '{}'::jsonb, 'preco_venda', 189.90)));
  select id into v_var from public.catalogo_variacoes where produto_id = v_prod;

  -- T1. Admin cria solicitacao de etiqueta -> grava com operacao_id certo, status pendente
  insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
    values (v_prod, v_var, 'TROLESI', 'R$ 189,90', 'Folheado ouro 18k', 'ZZ001', 3)
    returning id into v_sol;
  select count(*) into v_n from public.solicitacoes_etiqueta where id = v_sol and operacao_id = v_varejo and status = 'pendente';
  if v_n <> 1 then raise exception 'TESTE FALHOU [T1]: solicitacao nao gravou pendente com a operacao certa'; end if;

  -- T2. App nao consegue marcar como impresso/erro (sem policy de update) -- so o print-agent
  -- (service_role, bypassa RLS) faz isso.
  begin
    update public.solicitacoes_etiqueta set status = 'impresso' where id = v_sol;
    raise exception 'TESTE FALHOU [T2]: app conseguiu dar update em solicitacoes_etiqueta (deveria ser so leitura/insercao)';
  exception when insufficient_privilege then null;
  end;

  -- T3. Checks de tamanho: linha3 > 20 e codigo > 8 sao rejeitados
  begin
    insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
      values (v_prod, v_var, 'TROLESI', 'R$ 1,00', 'Um texto de atributo bem mais longo que vinte', 'A', 1);
    raise exception 'TESTE FALHOU [T3]: linha3 acima de 20 caracteres deveria falhar no check';
  exception when check_violation then null;
  end;
  begin
    insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
      values (v_prod, v_var, 'TROLESI', 'R$ 1,00', '', 'CODIGOMUITOLONGO', 1);
    raise exception 'TESTE FALHOU [T3]: codigo acima de 8 caracteres deveria falhar no check';
  exception when check_violation then null;
  end;

  -- T4. Quantidade fora de 1..999 e rejeitada
  begin
    insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
      values (v_prod, v_var, 'TROLESI', 'R$ 1,00', '', 'A', 0);
    raise exception 'TESTE FALHOU [T4]: quantidade 0 deveria falhar no check';
  exception when check_violation then null;
  end;

  -- T5. So VAREJO -> ATACADO e recusado (operacao_id vem do contexto, trava generica ja existente)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_atacado))::text, true);
  insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
    values (v_prod, v_var, 'TROLESI', 'R$ 1,00', '', 'A', 1) returning id into v_sol;
  select count(*) into v_n from public.solicitacoes_etiqueta where id = v_sol and operacao_id = v_atacado;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T5]: solicitacao criada no Atacado nao carimbou operacao_id do Atacado'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);

  -- T6. Papel estoque consegue criar solicitacao (mesmo acesso que cadastra peca no catalogo)
  if v_estoque is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_estoque, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
      values (v_prod, v_var, 'TROLESI', 'R$ 1,00', '', 'A', 1);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T6 pulado: nenhum profile com papel estoque encontrado.';
  end if;

  -- T7. Vendedor nao enxerga nem escreve (RLS: so admin/estoque tem policy de insert/select)
  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    select count(*) into v_n from public.solicitacoes_etiqueta;
    if v_n <> 0 then raise exception 'TESTE FALHOU [T7]: vendedor enxergou % linha(s) de solicitacoes_etiqueta (deveria ser 0)', v_n; end if;
    begin
      insert into public.solicitacoes_etiqueta (produto_id, variacao_id, linha1, preco, linha3, codigo, quantidade)
        values (v_prod, v_var, 'TROLESI', 'R$ 1,00', '', 'A', 1);
      raise exception 'TESTE FALHOU [T7]: vendedor conseguiu criar solicitacao de etiqueta';
    exception when insufficient_privilege or others then null;
    end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T7 pulado: nenhum profile com papel vendedor encontrado.';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T7 (fila pendente, so print-agent marca status, checks de tamanho/quantidade, isolamento de operacao, permissao admin/estoque, vendedor negado).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop table if exists public.solicitacoes_etiqueta cascade;
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
    select 'TAB ' || t.table_name as item from information_schema.tables t
     where t.table_schema = 'public' and t.table_name = 'solicitacoes_etiqueta';

  select string_agg(d.marca || ' ' || d.item, E'\n' order by d.marca, d.item) into v_dif
  from (
    select 'FALTA_APOS_ROLLBACK' as marca, a.item from (select item from _fp_antes except select item from _fp_depois) a
    union all
    select 'SOBROU_APOS_ROLLBACK' as marca, b.item from (select item from _fp_depois except select item from _fp_antes) b
  ) d;

  if v_dif is not null then
    raise exception E'ENSAIO FALHOU: o rollback nao devolveu o estado inicial.\n%', left(v_dif, 3000);
  end if;

  raise exception 'ENSAIO OK: fila de solicitacoes_etiqueta (etiqueta de joia 95x12mm, Elgin L42 Pro Full), testada (T1 a T7) e desfeita identica ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
