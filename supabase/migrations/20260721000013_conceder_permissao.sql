-- Fase 5: UI de concessão de permissões granulares — fecha a pendência
-- registrada em PROJECT_STATUS.md ("hoje só admin exerce qualquer
-- permissão especial porque não existe tela pra popular
-- `permissoes_usuario`"). Duas functions em vez de insert/delete direto do
-- cliente na tabela (que a RLS já permitiria pro admin): mesmo padrão do
-- resto do projeto (checagem de papel dentro da function, defesa em
-- profundidade além da RLS) + auditoria — a revogação em particular
-- *precisa* de uma function, porque um DELETE direto não deixa rastro
-- nenhum de que a permissão existiu e foi removida.
--
-- ROLLBACK:
-- drop function if exists public.conceder_permissao(uuid, public.permissao_especial);
-- drop function if exists public.revogar_permissao(uuid, public.permissao_especial);

create or replace function public.conceder_permissao(
  p_profile_id uuid,
  p_permissao public.permissao_especial
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Usuário não encontrado.';
  end if;

  insert into public.permissoes_usuario (profile_id, permissao, concedida_por)
  values (p_profile_id, p_permissao, auth.uid())
  on conflict (profile_id, permissao) do nothing;

  perform public.registrar_auditoria(
    'permissoes_usuario', p_profile_id, 'conceder_permissao',
    null, jsonb_build_object('permissao', p_permissao), null
  );
end;
$$;

create or replace function public.revogar_permissao(
  p_profile_id uuid,
  p_permissao public.permissao_especial
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  delete from public.permissoes_usuario
    where profile_id = p_profile_id and permissao = p_permissao;

  perform public.registrar_auditoria(
    'permissoes_usuario', p_profile_id, 'revogar_permissao',
    jsonb_build_object('permissao', p_permissao), null, null
  );
end;
$$;

revoke all on function public.conceder_permissao(uuid, public.permissao_especial) from public;
grant execute on function public.conceder_permissao(uuid, public.permissao_especial) to authenticated;

revoke all on function public.revogar_permissao(uuid, public.permissao_especial) from public;
grant execute on function public.revogar_permissao(uuid, public.permissao_especial) to authenticated;
