# CHANGELOG — ERP Trolesi

## 2026-07-13 (cont. 5) — Fase 4: Cadastros

- Módulo de Cadastros completo: CRUD de clientes e fornecedores (criar, editar, ativar/desativar, excluir com proteção contra erro de FK).
- Cliente: endereço completo (bairro, CEP), data de nascimento, e-mail, e bloco de dados da Receita Federal (razão social, nome fantasia, situação cadastral, data de abertura, natureza jurídica, porte, atividade principal). 2 migrations novas aplicadas no projeto real.
- Busca automática por CNPJ (BrasilAPI + fallback ReceitaWS) preenchendo o formulário inteiro, em Clientes e Fornecedores.
- Cadastro rápido de cliente também na tela de Pedidos (única fatia desse módulo implementada antes do Estoque, a pedido do usuário — ver `DECISIONS.md`).
- Layout todo responsivo — sidebar vira gaveta em mobile (`src/components/app-shell.tsx`).
- Bugs reais encontrados e corrigidos durante o teste ao vivo com o usuário: modal não centralizava (reset de `margin` do Tailwind conflitando com centralização nativa do `<dialog>`), BrasilAPI bloqueando o User-Agent padrão do Node com 403, campos da Receita Federal não preenchiam por causa de uma corrida entre estado React e DOM.
- Code-review de 8 ângulos rodado e aplicado: fallback de CNPJ não tentava a 2ª fonte quando a 1ª travava, cache do Pedidos desatualizado após desativar/excluir cliente, aba Funcionários quebrando silenciosamente pra quem não é admin, duas funções duplicadas extraídas para `src/lib/filtra.ts` e `src/lib/preencher-form.ts`.
- Build e lint confirmados limpos após todas as correções.

## 2026-07-13 (cont. 4)

- Primeiro usuário admin criado (`lucasptrolesi@gmail.com`) e promovido via SQL Editor do dashboard.
- Login testado de ponta a ponta no dev server local — funcionando.
- Adicionado `console.error` server-side em `src/app/login/actions.ts` para diagnosticar falhas de login sem expor a causa real ao usuário (mensagem pro usuário continua genérica, por segurança).

## 2026-07-13 (cont. 3)

- Fase 3 concluída: scaffold Next.js 16 + Tailwind v4 + Supabase Auth (`@supabase/ssr`), com `src/proxy.ts` protegendo rotas, layout autenticado com a sidebar do mockup, tela de login, e páginas placeholder para os 5 módulos da Fase 4.
- Code-review de 8 ângulos rodado sobre o diff; 4 achados reais corrigidos: cookies de sessão perdidos em redirect do middleware, busca duplicada de usuário/perfil (consolidada em `getPerfilAtual()` com `cache()`), checagem de auth inconsistente entre arquivos, e estilo de marca duplicado (extraído para `BrandBadge`).
- Build de produção e lint confirmados limpos após as correções; fluxo de redirecionamento (`/` → `/login` sem sessão) testado no dev server.

## 2026-07-13 (cont. 2)

- Projeto Supabase real `trolesi-erp` criado pelo usuário (São Paulo, sa-east-1).
- As 7 migrations aplicadas com sucesso via pooler de sessão (`aws-1-sa-east-1.pooler.supabase.com`) — conexão direta é IPv6-only e não alcançável do ambiente local, exigiu descobrir o host correto do pooler.
- Verificado: 10 tabelas criadas, RLS ativo em 100% delas, 20 políticas no total.
- Fase 2 concluída.

## 2026-07-13 (cont.)

- `git init` + primeiro commit (16 arquivos). Sem remoto configurado.
- Passo do Supabase real (criar projeto) identificado como dependente da conta do usuário — instruções passadas, aguardando Project URL + anon key para aplicar as migrations e seguir para a Fase 3.

## 2026-07-13

- **Fase 2 preparada:** 7 migrations SQL escritas em `supabase/migrations/` — RBAC (`profiles`, papéis admin/vendedor/financeiro/estoque), Cadastros (`clientes`, `fornecedores`), Estoque (`produtos`, `movimentos_estoque`), Pedidos (`pedidos`, `pedido_itens`), Financeiro (`contas_receber`, `contas_pagar`), Fiscal (`notas_fiscais`), RLS habilitado e com política própria em toda tabela. Nenhuma aplicada ainda em projeto real.
- Adicionado `supabase/README.md` com a matriz de acesso por papel e instruções de aplicação.
- Criados `CLAUDE.md`, `PROJECT_STATUS.md`, `DECISIONS.md`, `CHANGELOG.md` para dar continuidade ao projeto entre sessões.
- Gate técnico da Fase 1 fechado.
- `.gitignore` ampliado para cobrir artefatos locais do Supabase CLI.

## 2026-07-12

- Mockup revisado (v2): removida a seção de consignação/maletas; cadastro "Clientes & Revendedoras" virou só "Clientes"; adicionada tela "Novo Pedido" (busca de cliente, itens com qtd./preço/subtotal, forma de pagamento, total, salvar orçamento ou faturar).
- Plano (`glowing-dreaming-music.md`) atualizado para remover consignação do modelo de dados e das fases.

## 2026-07-11

- Fase 0 concluída: banco `GMaxERP.FDB` (cópia) lido via Firebird Embedded + Python (`fdb`), sem instalar nada no sistema. 570 tabelas mapeadas, 180 com dado real, 46 tabelas de negócio exportadas para CSV em `migracao-dados/export_csv/`.
- Descoberto que "Sincron" é a pasta de sincronização de NF-e do próprio GMax, não um segundo sistema.
- Escopo do MVP fechado com o usuário: Cadastros, Estoque, Pedidos, Financeiro, Fiscal/NF-e (com emissão real adiada até conferência aprovada).
- Mockup v1 publicado (Dashboard, Cadastros, Estoque, Pedidos + Consignação, Financeiro, Fiscal).
- Plano aprovado e salvo em `C:\Users\Micro\.claude\plans\glowing-dreaming-music.md`.
