# Schema Supabase — ERP Trolesi

Migrations em `migrations/`, na ordem em que devem ser aplicadas (prefixo de timestamp já garante a ordem certa).

## Como as migrations são aplicadas hoje (nota histórica — atualizado 2026-07-20)

O projeto Supabase real (`trolesi-erp`) já existe e está em produção desde a Fase 2. Na prática, todas as migrations até aqui foram aplicadas por um script Python (`psycopg2`) conectando direto no *session pooler* do projeto (`aws-1-sa-east-1.pooler.supabase.com`), não pelo `supabase db push` — o CLI nunca chegou a ser usado neste projeto. Não existe ambiente de staging separado; toda migration nova roda direto contra produção.

## Convenção de rollback (a partir de 2026-07-20, Fase 1 do documento mestre)

Migrations aplicadas **antes** desta data (`20260713*` a `20260716*`, 21 arquivos) não foram reescritas — não têm rollback formal, só o registro de que foram aplicadas com sucesso e verificadas por contagem/consulta direta ao catálogo do Postgres.

**Toda migration nova a partir daqui** ganha um cabeçalho `-- ROLLBACK:` comentado, descrevendo o SQL exato pra reverter aquela migration especificamente (não um "down.sql" separado — mantém a reversão ao lado da mudança, mais fácil de não ficar desatualizado). Exemplo:

```sql
-- ROLLBACK:
-- drop table if exists public.pending_decisions;

create table public.pending_decisions (
  ...
);
```

Antes de rodar qualquer migration nova contra o banco real de produção, o rollback comentado é revisado junto — se something der errado depois de aplicada, o comando de reversão já está pronto, não precisa ser improvisado sob pressão.

## Tabelas por módulo

| Migration | Módulo | Tabelas |
|---|---|---|
| `20260713000001` | RBAC | `profiles`, enum `papel_usuario`, função `meu_papel()`, trigger de auto-criação de perfil |
| `20260713000002` | Cadastros | `clientes`, `fornecedores` |
| `20260713000003` | Estoque | `produtos`, `movimentos_estoque` |
| `20260713000004` | Pedidos | `pedidos`, `pedido_itens` |
| `20260713000005` | Financeiro | `contas_receber`, `contas_pagar` |
| `20260713000006` | Fiscal | `notas_fiscais` |
| `20260713000007` | — | trigger utilitário de `atualizado_em` |

## Matriz de acesso (RLS por papel)

| Tabela | admin | vendedor | financeiro | estoque |
|---|---|---|---|---|
| `profiles` | leitura/escrita de todos | só o próprio | só o próprio | só o próprio |
| `clientes` | leitura/escrita | leitura/escrita | leitura | leitura |
| `fornecedores` | leitura/escrita | leitura | leitura/escrita | leitura |
| `produtos` | leitura/escrita | leitura | leitura | leitura/escrita |
| `movimentos_estoque` | leitura/escrita | cria (venda) | leitura | leitura/escrita |
| `pedidos`, `pedido_itens` | leitura/escrita | leitura/escrita | leitura | leitura |
| `contas_receber`, `contas_pagar` | leitura/escrita | sem acesso | leitura/escrita | sem acesso |
| `notas_fiscais` | leitura/escrita | só dos próprios pedidos | leitura/escrita | sem acesso |

Todo acesso exige `auth.uid()` válido — sem usuário logado, RLS bloqueia tudo por padrão (nenhuma policy libera acesso anônimo em nenhuma tabela).

## O que NÃO está aqui de propósito

- **Sem dados reais.** As migrations criam só estrutura. A importação dos CSVs reais (`../migracao-dados/export_csv/`) acontece na Fase 5, depois que o schema estiver validado.
- **Sem credenciais fiscais.** `notas_fiscais` guarda o resultado (XML, status, protocolo) — a chave de API do provedor de NF-e (Focus NFe) fica em variável de ambiente da aplicação (Fase 3+), nunca em tabela.
- **Sem emissão real habilitada.** O `status_nota_fiscal` para no máximo em `validada` até a Fase 6 (conferência) ser aprovada pelo usuário; `autorizada` só passa a significar emissão real na SEFAZ na Fase 7.
