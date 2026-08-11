-- Trava de CNPJ duplicado em fornecedores (achado de code review, 2026-08-11
-- — ver DECISIONS.md): `clientes` já tem `clientes_cpf_cnpj_key`, mas
-- `fornecedores` (schema original, 20260713000002_cadastros.sql) nunca
-- ganhou o equivalente — dava pra cadastrar o mesmo fornecedor duas vezes.
-- Mesmo padrão de clientes_cpf_cnpj_key: parcial (`where cnpj is not null`),
-- já que `cnpj` é opcional no cadastro. Também destrava o branch de erro
-- 23505 em `mensagemErroSalvar` (src/lib/actions/erros.ts) pra esse
-- cadastro, que hoje é código morto ali por falta de constraint pra violar.
--
-- ROLLBACK:
-- drop index if exists public.fornecedores_cnpj_key;

create unique index fornecedores_cnpj_key on public.fornecedores (cnpj) where cnpj is not null;
