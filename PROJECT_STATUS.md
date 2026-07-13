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

- **Nenhum projeto Supabase existe ainda.** As migrations estão prontas mas não têm onde rodar — precisa da conta/criação do projeto pelo usuário antes da Fase 3.
- **Prints do toqMax** ainda não recebidos — não bloqueia a Fase 2/3, mas o fluxo de "Novo Pedido" pode ganhar ajustes finos quando chegarem.
- **Sem `git init` ainda** — o diretório não é um repositório git. A skill `code-review` (gate obrigatório antes de qualquer módulo "pronto") depende de diff de git; isso precisa existir antes ou durante a Fase 3.

## Próxima tarefa

**Fase 3 — Scaffold Next.js.** Precisa, antes de codar:
1. Confirmar com o usuário se cria um projeto Supabase novo (recomendado, dado que é dado sensível de negócio, separado do projeto da landing page) ou reaproveita algum existente.
2. `git init` no diretório do projeto (ainda não é repositório git).
3. Scaffold Next.js 14 App Router + TypeScript + Tailwind, layout base com a sidebar do mockup, e tela de login via Supabase Auth.
