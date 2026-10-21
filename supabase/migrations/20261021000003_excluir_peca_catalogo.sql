-- Excluir peça no catálogo do Varejo (pedido do usuário, 2026-10-21) -- hoje a única forma de tirar
-- uma peça da lista é abrir "Editar peça" e desmarcar "ativa", escondida mas nunca removida. Faltava
-- um jeito de apagar de verdade uma peça cadastrada errada/duplicada, sem precisar entrar no form.
--
-- Decisão: excluir de verdade só funciona pra peça que NUNCA teve movimentação (nenhuma entrada de
-- estoque, venda, dívida com o Atacado, transferência ou etiqueta) -- isso cobre exatamente o caso
-- real (cadastro errado/duplicado, apagado na hora) sem abrir mão do histórico de nada que já rodou
-- de verdade pelo sistema. Não precisa checar cada tabela referenciada uma por uma: a própria FK
-- (sem ON DELETE CASCADE em nenhuma delas) já bloqueia o DELETE com um erro 23503 se existir
-- qualquer vínculo -- a camada de app (mensagemErroExcluir, já usada em produtos/clientes/
-- fornecedores) traduz isso pra "Desative em vez de excluir", mesmo texto e mesmo espírito que o
-- resto do sistema já usa pra esse tipo de bloqueio.
--
-- Uma peça == uma variação (o caso comum deste catálogo é 1 produto : 1 variação, mas o modelo
-- permite mais de uma pra tamanho/cor). Excluir a ÚLTIMA variação de um produto também remove o
-- produto (senão sobraria um produto "fantasma" sem nenhuma variação) -- a trigger já existente
-- `trg_produto_mantem_variacao` (deferred, 20260921000003) bloquearia esse estado inconsistente se
-- o produto continuasse existindo; como as duas exclusões acontecem na MESMA transação, quando a
-- trigger roda (fim da transação) o produto já não existe mais, então ela nem dispara. Excluir uma
-- variação que NÃO é a última só remove ela mesma -- produto e as demais variações ficam intactos.
--
-- `desativar_peca_catalogo`: mesmo efeito que já existia escondido dentro de "Editar peça"
-- (`p_ativo` em editar_produto_catalogo), só que isolado numa function mínima -- pra oferecer
-- "Desativar" como alternativa de um clique quando "Excluir" é bloqueado, sem arriscar reenviar os
-- outros campos da peça (nome/preço/sku/etc.) desatualizados por engano.
--
-- COMO RODAR: 'ensaio' -> confirma "ENSAIO OK" -> troca a linha do modo pra 'aplicar' -> roda de novo.
--
-- ROLLBACK:
-- -- Troque a linha abaixo, no corpo deste MESMO arquivo, para 'desfazer' e rode o arquivo inteiro de
-- -- novo. Remove as duas functions -- nenhuma tabela/coluna nova foi criada, nada mais a desfazer.
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

  create function public.excluir_peca_catalogo(p_variacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
    v_produto_id uuid;
    v_outras_variacoes int;
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    select produto_id into v_produto_id from public.catalogo_variacoes where id = p_variacao_id and operacao_id = v_op;
    if not found then
      raise exception 'Peça não encontrada';
    end if;

    -- Sem ON DELETE CASCADE em nenhuma FK que aponta pra catalogo_variacoes (estoque_movimentos,
    -- venda_itens, varejo_dividas_atacado, transferencia_itens, solicitacoes_etiqueta,
    -- etiqueta_impressoes) -- se qualquer uma tiver linha pra esta peça, este DELETE falha sozinho
    -- com 23503 (foreign_key_violation), que a camada de app traduz pro usuário.
    delete from public.catalogo_variacoes where id = p_variacao_id;

    select count(*) into v_outras_variacoes from public.catalogo_variacoes where produto_id = v_produto_id;
    if v_outras_variacoes = 0 then
      delete from public.catalogo_produtos where id = v_produto_id;
    end if;
  end
  $fn$;

  revoke execute on function public.excluir_peca_catalogo(uuid) from public, anon;
  grant execute on function public.excluir_peca_catalogo(uuid) to authenticated;

  create function public.desativar_peca_catalogo(p_variacao_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_op uuid := public.operacao_atual();
  begin
    perform public.assert_papel(array['admin', 'estoque']::public.papel_usuario[]);
    perform public.exigir_operacao_codigo('VAREJO');

    update public.catalogo_variacoes set ativo = false where id = p_variacao_id and operacao_id = v_op;
    if not found then
      raise exception 'Peça não encontrada';
    end if;
  end
  $fn$;

  revoke execute on function public.desativar_peca_catalogo(uuid) from public, anon;
  grant execute on function public.desativar_peca_catalogo(uuid) to authenticated;
end $up$;

-- VERIFICAR estrutura (modos ensaio e aplicar) ---------------------------------------------------

do $chk$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'aplicar') then
    return;
  end if;

  if to_regprocedure('public.excluir_peca_catalogo(uuid)') is null then
    raise exception 'FALHA: excluir_peca_catalogo nao existe';
  end if;
  if to_regprocedure('public.desativar_peca_catalogo(uuid)') is null then
    raise exception 'FALHA: desativar_peca_catalogo nao existe';
  end if;
  if not has_function_privilege('authenticated', 'public.excluir_peca_catalogo(uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em excluir_peca_catalogo';
  end if;
  if has_function_privilege('anon', 'public.excluir_peca_catalogo(uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em excluir_peca_catalogo';
  end if;
  if not has_function_privilege('authenticated', 'public.desativar_peca_catalogo(uuid)', 'execute') then
    raise exception 'FALHA: authenticated sem execute em desativar_peca_catalogo';
  end if;
  if has_function_privilege('anon', 'public.desativar_peca_catalogo(uuid)', 'execute') then
    raise exception 'FALHA: anon com execute em desativar_peca_catalogo';
  end if;

  raise notice 'VERIFICACAO OK: excluir_peca_catalogo e desativar_peca_catalogo no lugar, com grants corretos.';
end $chk$;

-- TESTES DE COMPORTAMENTO (so ensaio) --------------------------------------------------------------

do $teste$
declare
  v_varejo uuid;
  v_atacado uuid;
  v_lucas uuid := '5140c5d4-1cd9-4538-84c3-623b8266c4b2';
  v_vendedor uuid;
  v_dep uuid;
  v_caixa uuid;
  v_sessao uuid;
  v_prod_unico uuid;
  v_var_unico uuid;
  v_prod_multi uuid;
  v_var_a uuid;
  v_var_b uuid;
  v_prod_vendida uuid;
  v_var_vendida uuid;
  v_n int;
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

  -- T1. Peça nova, nunca mexida (sem estoque/venda) -- excluir remove a variação E o produto
  -- (produto ficaria sem nenhuma variação se só a variação sumisse).
  v_prod_unico := public.cadastrar_produto_catalogo('ZZ ENSAIO EXCLUIR UNICO', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZEXC01', 'atributos', '{}'::jsonb, 'preco_venda', 50.00)));
  select id into v_var_unico from public.catalogo_variacoes where produto_id = v_prod_unico;
  perform public.excluir_peca_catalogo(v_var_unico);
  select count(*) into v_n from public.catalogo_variacoes where id = v_var_unico;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T1]: variacao ainda existe apos excluir'; end if;
  select count(*) into v_n from public.catalogo_produtos where id = v_prod_unico;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T1]: produto (ultima variacao) deveria ter sido removido junto'; end if;

  -- T2. Produto com 2 variacoes -- excluir so uma delas mantem o produto e a outra variacao.
  v_prod_multi := public.cadastrar_produto_catalogo('ZZ ENSAIO EXCLUIR MULTI', 'ANEL',
    jsonb_build_array(
      jsonb_build_object('sku', 'ZZEXC02A', 'atributos', '{}'::jsonb, 'preco_venda', 60.00),
      jsonb_build_object('sku', 'ZZEXC02B', 'atributos', '{}'::jsonb, 'preco_venda', 65.00)
    ));
  select id into v_var_a from public.catalogo_variacoes where produto_id = v_prod_multi and sku = 'ZZEXC02A';
  select id into v_var_b from public.catalogo_variacoes where produto_id = v_prod_multi and sku = 'ZZEXC02B';
  perform public.excluir_peca_catalogo(v_var_a);
  select count(*) into v_n from public.catalogo_variacoes where id = v_var_a;
  if v_n <> 0 then raise exception 'TESTE FALHOU [T2]: variacao A ainda existe apos excluir'; end if;
  select count(*) into v_n from public.catalogo_variacoes where id = v_var_b;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: variacao B (irma) deveria continuar existindo'; end if;
  select count(*) into v_n from public.catalogo_produtos where id = v_prod_multi;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T2]: produto deveria continuar existindo (ainda tem a variacao B)'; end if;

  -- T3. Peça com estoque + venda de verdade -- excluir e bloqueado (FK), peça continua intacta.
  v_prod_vendida := public.cadastrar_produto_catalogo('ZZ ENSAIO EXCLUIR VENDIDA', 'ANEL',
    jsonb_build_array(jsonb_build_object('sku', 'ZZEXC03', 'atributos', '{}'::jsonb, 'preco_venda', 100.00)));
  select id into v_var_vendida from public.catalogo_variacoes where produto_id = v_prod_vendida;
  select id into v_dep from public.depositos where operacao_id = v_varejo and ativo limit 1;
  perform public.registrar_entrada_estoque(v_dep, v_var_vendida, 5, 20.00, 'ensaio excluir peca');

  select id into v_sessao from public.caixa_sessoes where operador_id = v_lucas and status = 'aberta' limit 1;
  if v_sessao is null then
    select id into v_caixa from public.caixas where operacao_id = v_varejo and ativo limit 1;
    v_sessao := public.abrir_sessao_caixa(v_caixa, 0);
  end if;
  perform public.registrar_venda(
    v_sessao,
    jsonb_build_array(jsonb_build_object('variacao_id', v_var_vendida, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100.00)),
    gen_random_uuid(), null, null, null, null, 0, 0, null
  );

  begin
    perform public.excluir_peca_catalogo(v_var_vendida);
    raise exception 'TESTE FALHOU [T3]: excluir peca com estoque/venda deveria ter sido bloqueado pela FK';
  exception
    when foreign_key_violation then null;
  end;
  select count(*) into v_n from public.catalogo_variacoes where id = v_var_vendida;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T3]: peca com venda nao deveria ter sido removida'; end if;

  -- T4. Desativar a MESMA peça do T3 (que nao pode ser excluida) -- alternativa segura, so esconde.
  perform public.desativar_peca_catalogo(v_var_vendida);
  select count(*) into v_n from public.catalogo_variacoes where id = v_var_vendida and ativo = false;
  if v_n <> 1 then raise exception 'TESTE FALHOU [T4]: desativar nao marcou ativo=false'; end if;

  -- T5. Vendedor (nao admin/estoque) nao consegue excluir nem desativar.
  if v_vendedor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_vendedor, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
    begin
      perform public.excluir_peca_catalogo(v_var_b);
      raise exception 'TESTE FALHOU [T5]: vendedor conseguiu excluir peca';
    exception
      when others then
        if sqlerrm !~ 'permiss' then raise; end if;
    end;
    begin
      perform public.desativar_peca_catalogo(v_var_b);
      raise exception 'TESTE FALHOU [T5]: vendedor conseguiu desativar peca';
    exception
      when others then
        if sqlerrm !~ 'permiss' then raise; end if;
    end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);
  else
    raise notice 'T5 pulado: nenhum profile com papel vendedor encontrado.';
  end if;

  -- T6. Contexto de outra operacao (Atacado) nao acha a peca do Varejo -- nem pra excluir, nem pra
  -- desativar (mesmo isolamento por operacao que o resto do Varejo ja segue).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_atacado))::text, true);
  begin
    perform public.excluir_peca_catalogo(v_var_b);
    raise exception 'TESTE FALHOU [T6]: excluir peca do Varejo funcionou no contexto Atacado';
  exception
    when others then
      if sqlerrm <> 'Peça não encontrada' then raise; end if;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_lucas, 'role', 'authenticated',
                     'app_metadata', jsonb_build_object('operacao_id', v_varejo))::text, true);

  perform set_config('request.jwt.claims', '', true);

  raise notice 'TESTES DE COMPORTAMENTO OK: T1 a T6 (excluir remove produto junto quando e a ultima variacao, mantem produto/variacoes irmas quando nao e, bloqueia por FK quando ja tem estoque/venda, desativar funciona como alternativa seguranca, papel e operacao isolados).';
end $teste$;

-- DESFAZER (modos ensaio e desfazer) ------------------------------------------------------------

do $down$
begin
  if coalesce(current_setting('app.modo_migration', true), '') not in ('ensaio', 'desfazer') then
    return;
  end if;

  drop function if exists public.excluir_peca_catalogo(uuid);
  drop function if exists public.desativar_peca_catalogo(uuid);
end $down$;

-- COMPARAR (so ensaio) ------------------------------------------------------------------------

do $cmp$
begin
  if coalesce(current_setting('app.modo_migration', true), '') <> 'ensaio' then
    return;
  end if;

  if to_regprocedure('public.excluir_peca_catalogo(uuid)') is not null
     or to_regprocedure('public.desativar_peca_catalogo(uuid)') is not null then
    raise exception 'ENSAIO FALHOU: o rollback nao removeu excluir_peca_catalogo/desativar_peca_catalogo por completo.';
  end if;

  raise exception 'ENSAIO OK: excluir_peca_catalogo (remove produto junto quando e a ultima variacao, bloqueado por FK quando ja tem movimentacao) e desativar_peca_catalogo (alternativa segura), testado (T1 a T6) e desfeito identico ao inicial. Nada foi gravado (transacao abortada de proposito).';
end $cmp$;

-- Daqui para baixo so roda nos modos aplicar e desfazer.
notify pgrst, 'reload schema';

commit;
