# PROJECT_STATUS — ERP Trolesi

_Atualizado em 2026-07-13._

## Estado por fase

| Fase | Status | Nota |
|---|---|---|
| 0 — Extração de dados reais do GMax | ✅ Concluída | 46 tabelas exportadas para CSV, ver `migracao-dados/` |
| 1 — Mockup das telas principais | ✅ Gate técnico fechado | Estrutura aprovada; alinhamento com telas do toqMax fica como refinamento não-bloqueante (aguardando prints) |
| 2 — Schema Supabase + Auth/RBAC + RLS | ✅ Concluída | Projeto real `trolesi-erp` (São Paulo, sa-east-1) criado pelo usuário. 7 migrations aplicadas com sucesso — 10 tabelas, RLS ativo em todas, 20 políticas. Verificado em 2026-07-13 |
| 3 — Scaffold Next.js + layout + login | ✅ Concluída | Next.js 16 + Tailwind v4 + Supabase Auth. Build/lint limpos, code-review (8 ângulos) aplicado. Ver detalhes abaixo |
| 4 — Implementação módulo a módulo | ⏳ Não iniciada | **Próxima tarefa.** Ordem: Cadastros → Estoque → Pedidos → Financeiro → Fiscal |
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

## Dados do projeto Supabase real

- Nome: `trolesi-erp` · Região: São Paulo (sa-east-1) · Organização: lucasptrolesi-ai
- Project URL: `https://cdbvudqmopjtbnpewhfc.supabase.co`
- Publishable key: guardada (não sensível, é a chave pública de cliente)
- Conexão de banco usada para aplicar as migrations: pooler `aws-1-sa-east-1.pooler.supabase.com`, sessão, porta 5432 (a conexão direta é IPv6-only, não alcançável do meu ambiente)
- **Recomendação de segurança pendente:** a senha do banco foi compartilhada em texto no chat para eu aplicar as migrations. Recomendo resetá-la agora em Project Settings → Database → Reset Database Password, já que as migrations já foram aplicadas e não preciso mais dela.

## Fase 3 — o que foi construído

- Next.js 16.2.10 (App Router, Turbopack) + TypeScript + Tailwind v4, `@supabase/ssr` para Auth SSR.
- `src/proxy.ts` (convenção nova do Next 16, substitui `middleware.ts`) protege todas as rotas — redireciona não-autenticado para `/login` e autenticado para fora de `/login`.
- `src/lib/supabase/auth.ts`: `getPerfilAtual()` com `cache()` do React — uma única busca de usuário+perfil por request, compartilhada entre o layout e as páginas (corrige duplicação encontrada no code-review).
- Layout autenticado (`src/app/(app)/layout.tsx`) com a sidebar do mockup (6 itens de menu), papel do usuário exibido, logout.
- Tela de login (`src/app/login/`) com Supabase Auth (e-mail/senha), erro genérico por segurança (não revela se o e-mail existe).
- Páginas placeholder para os 5 módulos futuros (`cadastros`, `estoque`, `pedidos`, `financeiro`, `fiscal`) — sem lógica de negócio, só evitam link quebrado no menu.
- Build de produção e lint rodando limpos, sem avisos.

## Code-review da Fase 3 (8 ângulos, `/code-review medium`)

Achados reais corrigidos:
1. **Middleware perdia cookies de sessão renovada em redirects** (`src/lib/supabase/middleware.ts`) — podia causar logout forçado intermitente quando o token renovava no mesmo request de um redirect. Corrigido: cookies copiados para a resposta de redirect.
2. **Busca duplicada de usuário/perfil** entre layout e dashboard (até 4 round-trips ao Supabase por carregamento) — consolidado num único helper (`getPerfilAtual`, com `cache()`).
3. **Checagem de auth inconsistente** (`user!.id` vs. redirect explícito) entre layout e página — eliminada junto com a duplicação acima.
4. **Estilo de marca (badge dourado, gradiente rosa) duplicado inline** em dois arquivos — extraído para `src/components/brand-badge.tsx`.

Achados registrados mas **não corrigidos agora** (custo/benefício não compensa para 4 papéis fixos e escopo da Fase 3): tipagem gerada do Supabase para `papel_usuario` (evitaria drift silencioso se o enum mudar), mensagem de erro genérica no login (decisão de segurança deliberada, não bug).

## Bloqueios / pendências reais

- **Nenhum usuário existe ainda no projeto.** O primeiro cadastro precisa ser feito via Supabase Dashboard (Authentication → Add User) — não há tela pública de auto-cadastro (decisão deliberada para uma ferramenta interna de 6 pessoas) — e depois promovido a `admin` manualmente via SQL.
- **Prints do toqMax** ainda não recebidos — não bloqueia a Fase 4, mas o fluxo de "Novo Pedido" pode ganhar ajustes finos quando chegarem.

## Próxima tarefa

**Fase 4 — Cadastros** (primeiro módulo, sozinho — não implementar os outros 4 juntos): CRUD de clientes e fornecedores sobre as tabelas já criadas na Fase 2, respeitando a RLS existente. Antes de começar: criar o primeiro usuário admin (ver bloqueio acima) para poder testar o fluxo autenticado de ponta a ponta.
