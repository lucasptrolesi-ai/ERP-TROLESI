-- Item 9 da auditoria LGPD de 2026-08-11 (ver DECISIONS.md): só existia log
-- de ESCRITA em audit_log, nunca de leitura de dado sensível. Aditivo — não
-- muda quem acessa o quê, só passa a registrar quando alguém abre a ficha
-- completa de um cliente (CPF/endereço visíveis).
--
-- Não dá pra chamar `registrar_auditoria` direto do client/Server Action:
-- o achado de segurança de 2026-07-21 (ver DECISIONS.md) revogou o EXECUTE
-- dela de `authenticated` de propósito, porque sem checagem interna
-- nenhuma ela permitiria forjar entrada de auditoria via RPC direto. Esta
-- function é um wrapper fino, mesmo padrão já usado em `assert_papel`/
-- `tem_permissao`/`pedido_tem_registro_financeiro`: só exige sessão válida
-- (não precisa checar papel específico — qualquer papel logado já lê
-- clientes hoje, ver achado 7 da mesma auditoria) e grava uma ação fixa.
--
-- ROLLBACK:
-- drop function if exists public.registrar_visualizacao_ficha_cliente(uuid);

create or replace function public.registrar_visualizacao_ficha_cliente(p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.';
  end if;
  perform public.registrar_auditoria('clientes', p_cliente_id, 'visualizacao_ficha_cliente');
end;
$$;

revoke all on function public.registrar_visualizacao_ficha_cliente(uuid) from public;
grant execute on function public.registrar_visualizacao_ficha_cliente(uuid) to authenticated;
