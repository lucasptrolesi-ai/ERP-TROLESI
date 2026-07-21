-- Fase 5 (pós-entrega): cadastro de funcionário pelo próprio app (antes só
-- dava pra criar usuário direto no Supabase Dashboard). A criação do login
-- em si (auth.users) acontece via Admin API (service_role key, só no
-- server action) — mas atualizar o papel e registrar auditoria continuam
-- precisando de uma function SECURITY DEFINER, no mesmo padrão de todo o
-- resto do projeto: `registrar_auditoria` foi travada (2026-07-21,
-- 20260721000019) pra só aceitar chamada de dentro de outra function
-- SECURITY DEFINER, nunca via RPC direto do cliente.
--
-- ROLLBACK:
-- drop function if exists public.registrar_funcionario_criado(uuid, public.papel_usuario, text);

create or replace function public.registrar_funcionario_criado(
  p_profile_id uuid,
  p_papel public.papel_usuario,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  -- O trigger handle_novo_usuario já criou a linha em profiles com papel
  -- 'vendedor' (padrão seguro) — só atualiza se o admin escolheu outro.
  if p_papel <> 'vendedor' then
    update public.profiles set papel = p_papel where id = p_profile_id;
  end if;

  perform public.registrar_auditoria(
    'profiles', p_profile_id, 'criar_funcionario',
    null, jsonb_build_object('email', p_email, 'papel', p_papel), null
  );
end;
$$;

revoke all on function public.registrar_funcionario_criado(uuid, public.papel_usuario, text) from public;
grant execute on function public.registrar_funcionario_criado(uuid, public.papel_usuario, text) to authenticated;
