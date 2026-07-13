# Schema Supabase — ERP Trolesi

Migrations em `migrations/`, na ordem em que devem ser aplicadas (prefixo de timestamp já garante a ordem certa pro Supabase CLI).

## Como aplicar (quando o projeto Supabase existir)

Nenhum projeto Supabase foi criado ainda — isso requer a conta do usuário. Quando existir:

```
supabase link --project-ref <ref-do-projeto>
supabase db push
```

Isso roda as 7 migrations na ordem, criando todo o schema + RLS de uma vez. Nenhuma delas insere dado real — são só estrutura.

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
