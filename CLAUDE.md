# ERP Trolesi — instruções do projeto

Substituição enxuta do GMax/Sincron (ERP atual da Trolesi Joias, Firebird 2.5) por um sistema web. Ver plano completo em `C:\Users\Micro\.claude\plans\glowing-dreaming-music.md` e status atual em `PROJECT_STATUS.md`.

## Regras de processo (não negociáveis)

1. **Gate de mockup.** Nenhuma tela vira código de aplicação sem aprovação visual prévia (Artifact tool / dev server). Mudanças visuais relevantes são sempre pré-visualizadas antes de codar.
2. **Gate de code-review.** Nenhum módulo é considerado "pronto" sem passar pela skill `code-review`.
3. **Módulo a módulo.** Não implementar todos os módulos de uma vez — seguir a ordem do plano (Cadastros → Estoque → Pedidos → Financeiro → Fiscal).
4. **Nunca usar o Firebird de produção.** Qualquer leitura do GMax é sobre cópia, nunca `erp trolesi/GMax/GMaxERP.FDB` diretamente.
5. **Nenhuma emissão fiscal real** até a Fase 7, e só com autorização explícita do usuário. Até lá, o módulo fiscal só gera XML para conferência.
6. **Dados sensíveis nunca em git:** `*.FDB`, `migracao-dados/export_csv/` (dados reais de clientes), `.env*`, certificado `.p12`/`.key` — ver `.gitignore`.
7. **Deploy só com autorização explícita.** Nunca fazer push para Vercel/produção automaticamente.

## Stack

- Next.js 14+ App Router + TypeScript + Tailwind (frontend — ainda não scaffolded, é a Fase 3)
- Supabase: Postgres + Auth + Storage + RLS (schema em `supabase/migrations/`, ver `supabase/README.md`)
- Vercel (hospedagem, quando autorizado)
- Provedor de NF-e: Focus NFe (integração via API, sem reimplementar o motor fiscal)

## RBAC

Quatro papéis: `admin`, `vendedor`, `financeiro`, `estoque`. Matriz completa de acesso por tabela em `supabase/README.md`.

## Time simulado

Não há programadores reais sendo contratados — um único agente assume os papéis (design via skill `artifact-design`, backend/schema via implementação direta, revisão via skill `code-review`).

## Onde encontrar as coisas

| O quê | Caminho |
|---|---|
| Plano completo | `C:\Users\Micro\.claude\plans\glowing-dreaming-music.md` |
| Status atual / próxima tarefa | `PROJECT_STATUS.md` |
| Histórico de decisões | `DECISIONS.md` |
| Histórico de mudanças | `CHANGELOG.md` |
| Mockup das telas | `design/mockup.html` |
| Schema do banco | `supabase/migrations/` |
| Dados reais exportados do GMax (gitignored) | `migracao-dados/export_csv/` |
