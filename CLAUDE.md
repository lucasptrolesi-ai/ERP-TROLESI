# ERP Trolesi — instruções do projeto

Substituição enxuta do GMax/Sincron (ERP atual da Trolesi Joias, Firebird 2.5) por um sistema web. Ver plano completo em `C:\Users\Micro\.claude\plans\glowing-dreaming-music.md` e status atual em `PROJECT_STATUS.md`.

**Pivô de escopo (2026-07-20/21):** o projeto foi fundido com um "documento mestre" de regras comerciais de PDV/loja de joalheria (desconto automático, parcelamento por limiar, primeira compra/reativação, abatimento de peças, garantias, crediário legado, comissões, frete), trazido pelo usuário. Esse documento mestre virou o processo oficial permanente (Fases 1-5: Fundação → Cadastros → Núcleo do PDV → Regras especiais → Relatórios/qualidade), estendendo o schema/código já existente em vez de recomeçar. Dashboard/Financeiro/Fiscal saíram do menu (código mantido, só desvinculado da navegação) — PDV (antiga tela de Pedidos) é a tela principal agora. Detalhes completos em `PROJECT_STATUS.md` e `DECISIONS.md`.

## Regras de processo (não negociáveis)

1. **Gate de mockup.** Nenhuma tela vira código de aplicação sem aprovação visual prévia (Artifact tool / dev server). Mudanças visuais relevantes são sempre pré-visualizadas antes de codar. **Exceção registrada:** todas as telas novas das Fases 4/5 do documento mestre (Abatimentos, Garantias, Crediário, Comissões, Frete, Relatórios, Permissões) foram construídas direto em código, sem mockup prévio, sob autorização explícita do usuário pra trabalhar de forma autônoma e rápida (`/goal`, "não precisa me perguntar nada, pode tomar as decisões") — ver `DECISIONS.md`. Não é precedente pra pular o gate por padrão; próximas telas novas com liberdade de design voltam a exigir mockup.
2. **Gate de code-review.** Nenhum módulo é considerado "pronto" sem passar pela skill `code-review`. Rodado sobre as Fases 1-4 em 2026-07-21, em 2 rodadas (10/10 ângulos completos na 2ª) — achados reais corrigidos, incluindo 1 crítico (ver `CHANGELOG.md`/`PROJECT_STATUS.md`). A partir daí, revisões seguintes usam `/code-review medium` em vez de `xhigh` por padrão (custo de token bem menor, ainda cobre os ângulos de maior sinal) — só sobe pra `xhigh` se o usuário pedir explicitamente ou o lote for excepcionalmente arriscado.
3. **Ordem de construção do documento mestre.** Fase 1 (Fundação) → Fase 2 (Cadastros estendidos) → Fase 3 (Núcleo do PDV) → Fase 4 (Regras especiais) → Fase 5 (Relatórios/qualidade). As 5 fases dos módulos originais (Cadastros/Estoque/Pedidos/Financeiro/Fiscal) continuam existindo no código; Financeiro/Fiscal/Dashboard só saíram da navegação, não foram apagados.
4. **Nunca usar o Firebird de produção.** Qualquer leitura do GMax é sobre cópia, nunca `erp trolesi/GMax/GMaxERP.FDB` diretamente.
5. **Nenhuma emissão fiscal real** até a Fase 7 original, e só com autorização explícita do usuário. Até lá, o módulo fiscal só gera XML para conferência (o módulo continua no código, só está fora do menu por ora).
6. **Dados sensíveis nunca em git:** `*.FDB`, `migracao-dados/export_csv/` (dados reais de clientes), `.env*`, certificado `.p12`/`.key` — ver `.gitignore`.
7. **Deploy.** Site publicado em 2026-07-21 (`https://erp-trolesi.vercel.app`), projeto Vercel `lpwebedatas-projects/erp-trolesi` com **Git integration ligada por decisão explícita do usuário** ("mantenha ligado") — todo `git push` pra `master` gera deploy automático em produção a partir de agora. Não é mais preciso pedir autorização a cada push por causa disso; a autorização original (2026-07-21) cobre o auto-deploy contínuo. Ainda assim, mudanças de schema/migration que afetam dado real continuam seguindo a disciplina normal (rollback documentado, aplicar com cuidado) antes de dar push.
8. **Toda migration nova segue a convenção de rollback** (bloco `-- ROLLBACK:` comentado no cabeçalho) desde 2026-07-20 — ver `supabase/README.md`.
9. **Ambiguidades de regra de negócio nunca são decididas por suposição.** Ficam registradas na tabela `pending_decisions` (banco real), com a funcionalidade correspondente atrás de `ativo=false`, até um humano autorizado decidir. **Atualização 2026-07-21:** as 10 ambiguidades originais da seção 27 do documento mestre foram decididas por instrução direta do usuário ("nada dessas perguntas, devem fazer parte do sistema") — decisão + justificativa de cada uma em `pending_decisions.decisao` e `DECISIONS.md`. A regra continua valendo pra ambiguidade **nova**, ainda não coberta pelo material que o usuário já forneceu.

## Stack

- Next.js 16 App Router (Turbopack) + TypeScript + Tailwind v4. **Atenção:** esta versão renomeou `middleware.ts` para `proxy.ts` (função exportada `proxy`, não `middleware`) e `cookies()`/`params`/`searchParams` são assíncronos — não assuma convenções de Next 13/14 sem checar `node_modules/next/dist/docs/` primeiro.
- Auth: `@supabase/ssr` (`createBrowserClient`/`createServerClient`), sessão validada com `getUser()` (nunca confiar só em `getSession()`). Usuário+perfil atual: sempre usar `getPerfilAtual()` de `src/lib/supabase/auth.ts` (cache por request), não duplicar a busca em cada página.
- Sem tela pública de auto-cadastro. **Desde 2026-07-21:** admin pode cadastrar funcionário (papéis operacionais: vendedor/financeiro/estoque) direto pelo app em `/permissoes`, via Admin API do Supabase (`src/lib/supabase/admin.ts`, service_role key em `SUPABASE_SERVICE_ROLE_KEY` — server-only, nunca `NEXT_PUBLIC_`, configurada local e no Vercel). Criar outro **admin** continua exigindo o Supabase Dashboard diretamente (não exposto no cadastro pelo app, por segurança).
- Recuperação/troca de senha: `/esqueci-senha` (link por e-mail) → `/redefinir-senha`; `/conta` pra trocar a senha já logado.
- Supabase: Postgres + Auth + Storage + RLS (schema em `supabase/migrations/`, ver `supabase/README.md`)
- Vercel (hospedagem, quando autorizado)
- Provedor de NF-e: Focus NFe (integração via API, sem reimplementar o motor fiscal)
- Testes: Vitest (`npm run test`) desde 2026-07-20 — regras comerciais viram funções puras testadas em `src/*.test.ts` (ex: `desconto.ts`, `parcelamento.ts`, `abatimento.ts`, `garantia.ts`, `comissao.ts`); regras implementadas só em SQL ficam registradas como `it.todo` em `src/lib/regras-comerciais.pendente.test.ts` até ganharem teste de integração de verdade.

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
