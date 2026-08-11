-- Item 7 da auditoria LGPD de 2026-08-11 (ver DECISIONS.md): a policy de
-- leitura de `clientes` liberava CPF/endereço/data de nascimento pra
-- qualquer papel logado, inclusive `estoque` — que não precisa desse dado
-- pra trabalhar. Verificado antes de aplicar: as únicas telas que `estoque`
-- acessa e que tocam `clientes` (Garantias, Abatimentos) só pedem
-- `clientes(nome)`, nunca campo sensível — restringir não deve quebrar
-- nada hoje. Decisão do usuário, 2026-08-12 (Opção A das duas apresentadas).
--
-- ROLLBACK:
-- drop policy "vendedor financeiro admin leem clientes" on public.clientes;
-- create policy "time logado lê clientes"
--   on public.clientes for select
--   using (auth.uid() is not null);

drop policy "time logado lê clientes" on public.clientes;

create policy "vendedor financeiro admin leem clientes"
  on public.clientes for select
  using (public.meu_papel() in ('admin', 'vendedor', 'financeiro'));
