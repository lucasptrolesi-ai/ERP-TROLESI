# PROJECT_STATUS — ERP Trolesi

_Atualizado em 2026-07-13._

## Estado por fase

| Fase | Status | Nota |
|---|---|---|
| 0 — Extração de dados reais do GMax | ✅ Concluída | 46 tabelas exportadas para CSV, ver `migracao-dados/` |
| 1 — Mockup das telas principais | ✅ Gate técnico fechado | Estrutura aprovada; alinhamento com telas do toqMax fica como refinamento não-bloqueante (aguardando prints) |
| 2 — Schema Supabase + Auth/RBAC + RLS | ✅ Migrations escritas | Ver `supabase/migrations/` (7 arquivos) e `supabase/README.md`. **Ainda não aplicadas** — nenhum projeto Supabase foi provisionado |
| 3 — Scaffold Next.js + layout + login | ⏳ Não iniciada | **Próxima tarefa** |
| 4 — Implementação módulo a módulo | ⏳ Não iniciada | Ordem: Cadastros → Estoque → Pedidos → Financeiro → Fiscal |
| 5 — Importação dos dados reais | ⏳ Não iniciada | Depende da Fase 3/4 e de um projeto Supabase real |
| 6 — Conferência fiscal (XML vs. GMax) | ⏳ Não iniciada | |
| 7 — Deploy + liberação da emissão fiscal real | ⏳ Não iniciada | Requer autorização explícita |

## Controle de versão

Repositório git inicializado em 2026-07-13 (`erp-trolesi-novo/.git`), primeiro commit feito com toda a estrutura atual (docs, mockup, migrations, `table_counts.json`). Nenhum remoto configurado ainda — só local.

## O que existe hoje no repositório

```
erp-trolesi-novo/
├── CLAUDE.md                  # instruções do projeto para sessões futuras
├── PROJECT_STATUS.md          # este arquivo
├── DECISIONS.md               # histórico de decisões de escopo
├── CHANGELOG.md               # histórico de mudanças
├── .gitignore                 # protege dados reais e segredos
├── design/
│   ├── mockup.html            # mockup das 6 telas (Dashboard, Cadastros, Estoque, Pedidos, Financeiro, Fiscal)
│   └── relatorio-status.md    # relatório anterior (2026-07-13, snapshot da Fase 0/1)
├── migracao-dados/
│   ├── export_csv/            # 46 tabelas reais do GMax, gitignored (dados de cliente)
│   └── table_counts.json      # contagem de linhas das 570 tabelas do GMax
└── supabase/
    ├── README.md               # matriz de RBAC, como aplicar as migrations
    └── migrations/              # 7 arquivos SQL (schema completo + RLS), ainda não aplicados em nenhum projeto real
```

## Bloqueios / pendências reais

- **Nenhum projeto Supabase existe ainda.** As migrations estão prontas mas não têm onde rodar. Criar o projeto exige login na conta Supabase do usuário — passo que só ele pode fazer (instruções dadas em 2026-07-13). Aguardando Project URL + anon key.
- **Prints do toqMax** ainda não recebidos — não bloqueia a Fase 2/3, mas o fluxo de "Novo Pedido" pode ganhar ajustes finos quando chegarem.

## Próxima tarefa

**Fase 3 — Scaffold Next.js**, assim que o Project URL + anon key do Supabase chegarem:
1. Aplicar as 7 migrations no projeto real (`supabase link` + `supabase db push`).
2. Scaffold Next.js 14 App Router + TypeScript + Tailwind, layout base com a sidebar do mockup, e tela de login via Supabase Auth.
3. Primeiro usuário precisa ser promovido a `admin` manualmente (o trigger cria todo novo usuário como `vendedor` por padrão de segurança) — via SQL direto no dashboard do Supabase.
