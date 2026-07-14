# PROJECT_STATUS — ERP Trolesi

_Atualizado em 2026-07-13._

## Estado por fase

| Fase | Status | Nota |
|---|---|---|
| 0 — Extração de dados reais do GMax | ✅ Concluída | 46 tabelas exportadas para CSV, ver `migracao-dados/` |
| 1 — Mockup das telas principais | ✅ Gate técnico fechado | Estrutura aprovada; alinhamento com telas do toqMax fica como refinamento não-bloqueante (aguardando prints) |
| 2 — Schema Supabase + Auth/RBAC + RLS | ✅ Concluída | Projeto real `trolesi-erp` (São Paulo, sa-east-1) criado pelo usuário. 7 migrations aplicadas com sucesso — 10 tabelas, RLS ativo em todas, 20 políticas. Verificado em 2026-07-13 |
| 3 — Scaffold Next.js + layout + login | ✅ Concluída | Next.js 16 + Tailwind v4 + Supabase Auth. Build/lint limpos, code-review (8 ângulos) aplicado. Ver detalhes abaixo |
| 4 — Implementação módulo a módulo | 🔶 Em andamento | Cadastros e Estoque concluídos. **Próxima:** Pedidos (venda de verdade). Ordem: Cadastros → Estoque → Pedidos → Financeiro → Fiscal |
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

## Primeiro usuário criado e login verificado (2026-07-13)

- Usuário admin: `lucasptrolesi@gmail.com`, promovido via SQL Editor do dashboard (`update public.profiles set papel = 'admin' where id = ...`).
- Login testado de ponta a ponta no dev server local: redirecionamento funcionando, sessão autenticada, papel "Admin" exibido corretamente.
- Durante o teste, a mensagem de erro genérica de login (decisão de segurança da Fase 3) escondeu a causa real de uma falha (`invalid_credentials`) — adicionado `console.error` só no servidor para diagnosticar sem expor detalhes ao usuário final. Mantido permanentemente (ver `src/app/login/actions.ts`).

## Fase 4 — Cadastros (concluído, 2026-07-13)

- CRUD completo de **clientes** e **fornecedores**: criar, editar, ativar/desativar (soft-delete), excluir de verdade (com mensagem amigável quando há pedidos/contas vinculados via FK — RESTRICT do banco, não um bug).
- Cliente ganhou: endereço completo (rua, bairro, CEP), data de nascimento, e-mail, e um bloco "Dados da Receita Federal" (razão social, nome fantasia, situação cadastral, data de abertura, natureza jurídica, porte, atividade principal) — duas migrations novas (`20260713000008`, `20260713000009`), já aplicadas no projeto real.
- **Busca automática por CNPJ**: botão "Buscar CNPJ" preenche o formulário inteiro. Usa BrasilAPI como fonte primária, com fallback pra ReceitaWS quando a primeira não encontra ou falha (cobre CNPJ de MEI aberto há pouco tempo, que a BrasilAPI ainda não indexou — problema real encontrado e corrigido durante o teste). Nenhuma chave de API necessária, as duas são públicas.
- Layout inteiro **responsivo**: sidebar vira menu-gaveta em telas mobile (`src/components/app-shell.tsx`).
- **Exceção deliberada à regra de "um módulo por vez":** a tela de Pedidos ganhou uma fatia mínima (busca + cadastro rápido de cliente, reaproveitando o mesmo formulário de Cadastros) a pedido explícito do usuário, antes do módulo de Estoque. Nenhuma lógica de venda/carrinho/produto foi implementada — isso continua esperando o módulo de Estoque. Registrado em `DECISIONS.md`.
- Code-review de 8 ângulos aplicado; achados reais corrigidos: fallback de CNPJ não tentava a 2ª fonte quando a 1ª travava (só quando "não encontrava"), duas ações não invalidavam o cache da tela de Pedidos, aba "Funcionários" quebrava silenciosamente pra quem não é admin (RLS só libera o próprio perfil), duas funções duplicadas extraídas pra `src/lib/filtra.ts` e `src/lib/preencher-form.ts`.

## Fase 4 — Estoque (concluído, 2026-07-14)

- CRUD completo de **produtos**: criar, editar, ativar/desativar (checkbox no próprio formulário), excluir (com mensagem amigável quando há pedidos/movimentos de estoque vinculados via FK).
- Grid de produtos com foto, categoria/subcategoria, preço calculado, status de estoque (ok/baixo/sem estoque, cor muda conforme o mínimo configurado), busca por nome/categoria/código interno, filtro por chip de categoria (deduplicado por grafia, case-insensitive).
- **Dois campos de código, propositalmente separados** (usuário corrigiu um mal-entendido meu no meio do caminho): `codigo_peca` é o valor numérico que × multiplicador (2,8 por padrão) gera o preço de venda — não é custo de aquisição, renomeado de `custo` via migration depois do usuário apontar o erro. `codigo_interno` é um código curto opcional, único, pra busca rápida tipo PDV — campo novo, migration própria.
- Extraído pra reuso (usado por Cadastros e Estoque): `src/lib/formatar-moeda.ts`, `src/lib/permissoes.ts` (centraliza a checagem de papel→permissão, antes duplicada em cada `*-view.tsx`). `FormField` ganhou suporte a `onChange`/`min`/`max`/`list`.
- Code-review de 8 ângulos (3 grupos) aplicado; achados reais corrigidos: busca não incluía categoria apesar do placeholder prometer, `codigo_peca`/`multiplicador` sem limite de faixa (permitia negativo ou estourava o `numeric(4,2)` do banco), `multiplicador` explícito `0` sendo silenciosamente substituído por 2,8 (armadilha clássica do `||` com falsy), toggle de "ativo" inexistente na UI apesar da mensagem de erro de exclusão mandar desativar.
- Três migrations novas (`20260713000010` rename custo→codigo_peca, `20260713000011` codigo_interno), já aplicadas no projeto real.

## Pendências reais

- **Prints do toqMax** ainda não recebidos — não bloqueia a Fase 4/5, mas o fluxo de venda completo (quando o módulo de Pedidos for feito de verdade) pode ganhar ajustes finos quando chegarem.
- **Reset da senha do banco** ainda recomendado (ver seção "Dados do projeto Supabase real" acima) — venho reusando a mesma senha compartilhada no início da Fase 2 pra aplicar migrations novas; nenhum problema até agora, mas continua sendo boa prática resetar.

## Próxima tarefa

**Fase 4 — Pedidos** (próximo módulo, agora de verdade): tela de venda completa — selecionar cliente, adicionar produtos do estoque com quantidade, calcular total, baixar estoque automaticamente (usando a tabela `movimentos_estoque` já criada na Fase 2), forma de pagamento. A fatia de "cadastro rápido de cliente" que já existe em `/pedidos` desde a Fase de Cadastros continua sendo reaproveitada.
