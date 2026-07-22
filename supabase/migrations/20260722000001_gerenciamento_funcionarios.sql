-- Fase 5 (pós-entrega): tela de Funcionários (Cadastros) vira totalmente
-- editável — editar nome/papel, resetar senha, desativar/reativar (com
-- bloqueio de login de verdade via ban do Supabase Auth, não só um rótulo
-- cosmético) e excluir. A criação (registrar_funcionario_criado) já existia
-- desde 20260721000022 — esta migration cobre as ações que faltavam,
-- reaproveitando o mesmo padrão (function genérica de auditoria, já que
-- registrar_auditoria só aceita chamada de dentro de outra SECURITY
-- DEFINER, nunca via RPC direto do cliente).
--
-- ROLLBACK:
-- drop function if exists public.registrar_acao_funcionario(uuid, text, jsonb, jsonb);

create or replace function public.registrar_acao_funcionario(
  p_profile_id uuid,
  p_acao text,
  p_valor_anterior jsonb default null,
  p_valor_novo jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);
  perform public.registrar_auditoria('profiles', p_profile_id, p_acao, p_valor_anterior, p_valor_novo, null);
end;
$$;

revoke all on function public.registrar_acao_funcionario(uuid, text, jsonb, jsonb) from public;
grant execute on function public.registrar_acao_funcionario(uuid, text, jsonb, jsonb) to authenticated;
