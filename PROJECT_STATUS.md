# PROJECT_STATUS — ERP Trolesi

_Atualizado em 2026-07-21._

## ⚠️ Pivô de escopo — leia isto primeiro

Em 2026-07-20/21 o usuário trouxe um **documento mestre** de regras comerciais de PDV/loja de joalheria (desconto automático por forma de pagamento, parcelamento por limiar de valor, primeira compra/reativação, abatimento de peças, garantias, crediário legado, comissões, frete/expedição, disciplina de testes/migrations reversíveis/permissões granulares/auditoria) e pediu explicitamente pra **fundir** esse documento com o projeto já existente, virando o processo oficial permanente daqui pra frente. Depois, com `/goal` (execução autônoma, sem pausar pra perguntar), pediu pra tocar isso até "o sistema completamente pronto".

O que isso mudou na prática:
- **Dashboard/Financeiro/Fiscal saíram do menu** (código mantido no repositório, só desvinculado da navegação — `src/components/sidebar-nav.tsx`). PDV (antiga tela de Pedidos) é a tela principal agora, `/` redireciona pra lá.
- As 7 fases originais abaixo continuam sendo **história real do que foi construído** — não foram descartadas. O documento mestre virou 5 fases novas (Fundação → Cadastros estendidos → Núcleo do PDV → Regras especiais → Relatórios/qualidade), documentadas na seção "Documento mestre" mais abaixo, que é onde o trabalho mais recente está.

## Estado por fase (histórico original, pré-fusão)

| Fase | Status | Nota |
|---|---|---|
| 0 — Extração de dados reais do GMax | ✅ Concluída | 46 tabelas exportadas para CSV, ver `migracao-dados/` |
| 1 — Mockup das telas principais | ✅ Gate técnico fechado | Estrutura aprovada; alinhamento com telas do toqMax fica como refinamento não-bloqueante (aguardando prints) |
| 2 — Schema Supabase + Auth/RBAC + RLS | ✅ Concluída | Projeto real `trolesi-erp` (São Paulo, sa-east-1) criado pelo usuário. 7 migrations aplicadas com sucesso — 10 tabelas, RLS ativo em todas, 20 políticas. Verificado em 2026-07-13 |
| 3 — Scaffold Next.js + layout + login | ✅ Concluída | Next.js 16 + Tailwind v4 + Supabase Auth. Build/lint limpos, code-review (8 ângulos) aplicado. Ver detalhes abaixo |
| 4 — Implementação módulo a módulo | ✅ Concluída (2026-07-16) | Cadastros, Estoque, Pedidos, Financeiro e **Fiscal** (modo conferência — gera XML/DANFE de rascunho, nada transmitido à SEFAZ) concluídos. Ordem seguida: Cadastros → Estoque → Pedidos → Financeiro → Fiscal. Ver detalhes abaixo. **Financeiro e Fiscal saíram do menu em 2026-07-20 (ver acima), código intacto** |
| 5 — Importação dos dados reais | ✅ Concluída (2026-07-14) | 51 clientes, 44 produtos, 172 pedidos (949 itens), 160 contas_receber importados do GMax pro Supabase real, numa transação só. Ver detalhes abaixo |
| 6 — Conferência fiscal (XML vs. GMax) | ⏳ Não iniciada, pausada | Módulo Fiscal fora do menu por ora (ver pivô acima) |
| 7 — Deploy + liberação da emissão fiscal real | ⏳ Não iniciada, pausada | |

**Fora das 7 fases originais, construído a pedido do usuário (2026-07-15):** Dashboard operacional (KPIs, pedidos recentes, estoque em alerta), fechamento de caixa diário/semanal/mensal (aba nova em Financeiro) e alerta de meta de faturamento mensal (R$55 mil) — também fora do menu desde 2026-07-20, código intacto.

## Documento mestre — estado por fase (trabalho mais recente, 2026-07-20/21)

| Fase | Status | Nota |
|---|---|---|
| 1 — Fundação | ✅ Concluída | Decisão de dinheiro documentada, Vitest instalado, permissões granulares, audit_log, pending_decisions (11 ambiguidades), paleta oficial aplicada |
| 2 — Cadastros estendidos | ✅ Concluída | Produtos ganharam ~25 atributos comerciais, vendedores, condições de pagamento configuráveis, locais de estoque |
| 3 — Núcleo do PDV | ✅ Concluída | Status `aguardando_lancamento_gmax`/`lancado_gmax`, desconto automático, parcelamento por limiar, primeira compra/reativação, idempotência, impressão |
| 4 — Regras especiais | ✅ Concluída | Todos os 5 sub-módulos (abatimento, garantias, crediário legado, comissões, frete/expedição) com schema, regra testada e UI funcional |
| 5 — Relatórios e qualidade | ✅ Núcleo funcional concluído | `/relatorios` completo, comissão automática (venda + recebimento), `/permissoes` (UI de concessão granular), frete grátis automático, pagamento misto, cotação diária, as 10 ambiguidades da seção 27 decididas e implementadas. **Code-review completo (10/10 ângulos)** + checagem leve de segurança adicional — ver detalhes abaixo |

Ver detalhes completos de cada fase mais abaixo, seção "Documento mestre — detalhes".

## Controle de versão

Repositório git inicializado em 2026-07-13 (`erp-trolesi-novo/.git`), remoto configurado em `https://github.com/lucasptrolesi-ai/ERP-TROLESI.git` (2026-07-16) — **tudo commitado e pushado até aqui**, histórico local e remoto sincronizados.

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

## Fase 4 — Pedidos (concluído, 2026-07-14)

- Tela de venda completa: busca/cadastro rápido de cliente, busca de produto com carrinho, quantidade limitada ao estoque disponível, e um campo "código da peça" editável por linha que recalcula o preço unitário na hora (código × multiplicador, ex.: 2,8) — útil quando o preço da peça mudou e a pessoa sabe o código de cabeça.
- Desconto/acréscimo manuais (% ou R$, os dois sincronizados) — substituiu um desconto automático de 7% "à vista" que tinha sido implementado antes e foi rejeitado explicitamente pelo usuário.
- 4 formas de pagamento: dinheiro, Pix, cartão de crédito (1-3x sem juros; 4-12x com um único campo "valor total já com o juros da maquininha", que funciona como simulador e divide em parcelas iguais só pra exibição) e promissória (até 4x, com data do 1º vencimento).
- **Extornar pedido** (cancela, devolve estoque se já tinha sido faturado, apaga as contas a receber geradas) e **ajustar valor** (edita desconto/acréscimo de um pedido já criado) — os dois acessíveis clicando na linha do pedido na lista, num modal de detalhe.
- Documentos imprimíveis: cupom térmico 80mm e notas promissórias em papel A4, reproduzindo o modelo físico real do TOQ Max (cabeçalho "República Federativa do Brasil", coluna de avalistas, número "nº-parcela/total", valor e data por extenso em português — `src/lib/extenso.ts`).
- **Achado crítico de segurança no code-review** (ver `DECISIONS.md`): as functions `SECURITY DEFINER` (`criar_pedido`, `extornar_pedido`) tinham uma checagem de papel NULL-unsafe que deixava qualquer sessão, inclusive não-autenticada, chamá-las sem permissão nenhuma. Corrigido na migration `20260714000002` e validado com uma chamada HTTP real sem sessão (retornava sucesso antes, `400 Sem permissão` depois).
- Code-review de 8 ângulos aplicado (2 rodadas); outros achados reais corrigidos: parcelas sendo geradas mesmo para status "orçamento", ausência de checagem servidor-side de que a soma das parcelas bate com o total do pedido, corrida entre extornar e ajustar (fechada com `for update`), drift de arredondamento na última parcela e juros do cartão não refletidos no total exibido na tela (achados durante o teste ao vivo do usuário, não pelo code-review).
- Build e lint confirmados limpos.

## Fase 4 — Financeiro (concluído, 2026-07-14)

- **Contas a receber**: alimentadas automaticamente pelas parcelas de cartão/promissória geradas em Pedidos (dinheiro/Pix não geram conta, já que são recebidos na hora) — sem cadastro manual, é reflexo do que já foi vendido.
- **Contas a pagar**: CRUD manual completo (descrição, fornecedor opcional, valor, vencimento, editar, excluir).
- **Baixa** ("marcar como pago"/"desfazer baixa") nas duas listas, com erro do servidor exibido no lugar em vez de falhar silenciosamente.
- Situação "Atrasado" é sempre calculada na hora comparando vencimento com a data de hoje (fuso `America/Sao_Paulo` explícito) — nunca fica presa a um valor gravado que nunca atualiza sozinho.
- KPIs: a receber em 30 dias, recebíveis em atraso, a pagar em 30 dias.
- **Acesso restrito a admin/financeiro** (RLS já garantia isso desde a Fase 2) — quem não tem permissão vê uma mensagem clara em vez de uma tela vazia enganosa.
- **Alerta de vencimentos**: sininho no cabeçalho com contador, abre automaticamente ao entrar no sistema se houver parcela a receber (admin+financeiro) ou conta a pagar (só admin, pedido explícito do usuário) vencendo hoje ou nos próximos 2 dias. "Não mostrar novamente hoje" grava a preferência no navegador por dia; o sininho sempre reabre o alerta sob demanda ("fácil acesso"). Reaproveita o componente `Modal` já usado em todo o app.
- **Code-review de 5 ângulos** encontrou e corrigiu, antes do commit: bug real de timezone (`toISOString()` é sempre UTC, virava o "dia" ~3h antes da meia-noite de Brasília, categorizando contas como atrasadas cedo demais e sumindo do alerta "vencendo hoje" nesse intervalo — 3 agentes bateram nisso independentemente); `extornar_pedido` apagando parcelas já marcadas como pagas no Financeiro (migration `20260714000003`, bloqueia o extorno nesse caso); erro da baixa sendo engolido silenciosamente no botão; `revalidatePath` não invalidando o layout raiz (o sininho ficava com contagem desatualizada depois de uma baixa ou de uma venda nova); queries sequenciais no layout paralelizadas; duplicações consolidadas (`marcarContaReceberPaga`/`marcarContaPagarPaga`, helpers de data, cast de embed do Supabase).
- **Exceção registrada ao gate de mockup** (ver `DECISIONS.md`): o alerta de vencimentos foi construído direto em código a partir de uma especificação detalhada do usuário no chat, sem Artifact/preview prévio — aprovado via teste ao vivo em vez de mockup estático.
- Build e lint confirmados limpos.

## Fase 5 — Importação dos dados reais (concluída, 2026-07-14)

- Script `migracao-dados/importar_dados_reais.py` roda em dois modos: `--relatorio` (só monta os dados em memória e escreve um relatório de contagens/amostras/linhas puladas, sem tocar no banco) e `--executar` (grava de verdade, numa transação só). Usado o modo relatório pra revisar antes de qualquer escrita real.
- **51 clientes** importados de 97 `PESSOA` do GMax — filtrado o administrador/família (marcados como colaborador) e **37 entidades de sistema disfarçadas de cliente** descobertas durante a importação: TRIBUTOS, CORREIOS, DAS/DAE/DARF, concessionárias de energia/telefone, SESI/SENAI/SEBRAE etc., todas com `FISICA_JURIDICA='J'` e **zero pedidos reais** vinculados — filtro final: pessoa jurídica só entra se tiver pelo menos 1 pedido de verdade.
- **44 produtos** com preço recalculado (`código = valor de venda ÷ 2,8`, multiplicador 2,8) batendo com o preço real do GMax; categoria inferida por palavra-chave no nome (best-effort, revisável depois pela tela de Estoque); estoque negativo do GMax (venda sem baixa correta no sistema antigo) zerado na importação.
- **172 pedidos históricos + 949 itens** inseridos direto nas tabelas (sem passar pela function `criar_pedido`, que duplicaria a baixa de estoque já refletida na quantidade atual); status e forma de pagamento mapeados a partir dos códigos reais do GMax (`STATUS_PEDIDO`/`CONDICOES_PAGAMENTO`).
- **160 contas_receber** (11 já pagas, 149 em aberto na importação) via `PARCELA_RECEBER` + `LANCAMENTO_RECEBER`.
- Fotos do catálogo da landing page (791) ficaram de fora — sem chave de junção confiável com os produtos reais do GMax (decisão registrada em `DECISIONS.md`).
- Antes de importar, os dados de teste que já estavam no banco (dos testes ao vivo dos módulos anteriores) foram apagados a pedido do usuário.

## Financeiro — revisão da baixa de títulos (concluída, 2026-07-14)

Com os 149 títulos em aberto reais importados (a maioria já vencida em relação à data de hoje), o usuário pediu uma forma organizada de "baixar os títulos" pra regularização. Revisão completa da tela de Contas a receber:

- **Baixa completa**: modal com data real do pagamento, valor efetivamente recebido (pode diferir do valor da parcela por desconto de quitação ou juro/multa), forma de pagamento usada (fica separada da forma prevista do pedido — "desfazer baixa" é totalmente reversível sem perder o dado original) e observação livre.
- **Agrupado por cliente** (accordion recolhido por padrão, ordenado pelo cliente com título mais atrasado primeiro), filtros por situação (Todos/Atrasados/Em dia/Pagos), seleção múltipla (checkbox global "selecionar todos" + por cliente + por título) com baixa em lote.
- **Baixa em lote atômica**: migration `20260714000005` criou a function `dar_baixa_em_lote_contas_receber` — um único `UPDATE` no banco em vez de um loop de updates um por um, com `valor_pago = valor` (pega o valor de face de cada linha automaticamente) e `where situacao != 'pago'` (não sobrescreve baixa já feita por outra pessoa).
- **Code-review de 5 ângulos** achou e corrigiu, antes do commit: bug de "Invalid Date" (`pago_em` é `timestamptz`, o formatador tratava como se fosse só data — achado por 2 agentes); risco de falha parcial/corrida na baixa em lote (achado por 4 agentes independentes, motivou a migration da function atômica); modal sem `<form>` (validação HTML5 nativa não disparava); duplicação de código entre as abas receber/pagar (extraídos `ResumoBaixa`/`AcaoBaixa`).
- Contas a pagar manteve a tela simples (tabela), só ganhou o mesmo modal de baixa mais completo — o volume real ali é zero por enquanto.
- Build e lint confirmados limpos.

## Dashboard + Fechamento de caixa + meta de faturamento (concluído, 2026-07-15)

- **Dashboard** (`src/app/(app)/page.tsx` + `dashboard-view.tsx`): reescrito do zero a partir do mockup já aprovado na Fase 1 — KPIs (pedidos hoje, ticket médio hoje, a receber em atraso/produtos ativos conforme o papel, estoque baixo), faturamento do mês com barra de progresso até a meta, painéis de pedidos recentes e estoque em alerta.
- **Fechamento de caixa** (nova terceira aba em Financeiro, `financeiro/fechamento-caixa.tsx`): seletor Diário/Semanal/Mensal com navegação ◀▶, faturamento total + variação % vs. período anterior, quebra por forma de pagamento, contas a receber/pagar do período, top produtos vendidos, e uma tabela "Vendas do período" (pedido/cliente/valor/forma de pagamento) — pedido explícito do usuário depois de ver a primeira versão.
- **Alerta de meta de R$55 mil/mês** (`alerta-meta-faturamento.tsx`): mesmo padrão do alerta de vencimentos (`useSyncExternalStore` + `localStorage`, chave por ano-mês), dispara uma vez quando o faturamento do mês corrente cruza a meta.
- Agregações (`src/lib/relatorios.ts`) calculadas em TypeScript a partir dos dados já buscados via `.select()`, sem function SQL nova — mesmo padrão já validado no Financeiro pro volume real da Trolesi (dezenas de pedidos/mês, não milhares).
- Extraído pra reuso: `situacao-conta.ts` (antes duplicado em Financeiro), `status-pedido.ts` (antes duplicado em Pedidos), `kpi-card.tsx`.
- Code-review de 5 ângulos aplicado; achado real corrigido: `deslocarPeriodo` pulava fevereiro inteiro ao navegar a partir de 31/janeiro no modo mensal (`data.setDate(data.getDate()+1)` em vez de fixar o dia em 1 antes de somar o mês).
- Build e lint confirmados limpos.

## Fase 4 — Fiscal/NF-e, modo conferência (concluído, 2026-07-16)

- Antes de construir, o usuário perguntou se dava pra integrar GMax↔Trolesi (emitir nota pelo GMax, controlar pedido/estoque pelo Trolesi). Investigação concluiu que não existe API suportada — o único mecanismo de sincronização externa do GMax (`SINCRON/`, `Config.ini`) é protocolo proprietário da TOQ Sistemas pra apps satélite, sem layout documentado pra pedidos, e os pedidos do GMax não carregam tributo calculado (só na emissão) — descartada a integração direta, ver `DECISIONS.md`.
- Migration `20260715000001` adiciona `ncm`/`csosn` em `produtos` e `cfop`/`natureza_operacao`/`serie` em `notas_fiscais`; patch pontual (`migracao-dados/patch_ncm_csosn.py`) preencheu NCM/CSOSN reais dos 44 produtos casando por nome com `PRODUTO.csv` do GMax.
- Fluxo: lista de pedidos faturados sem nota → "Gerar XML" cria a nota (CFOP automático: 5101 dentro de MG / 6101 fora, confirmado com o usuário batendo com o histórico real) → tela de conferência (XML + CFOP/natureza editáveis) → "Marcar como validada".
- **DANFE printável reconstruído para bater com o padrão visual real** — o usuário compartilhou uma DANFE real emitida pelo GMax e pediu fidelidade ("quero as notas nesse padrão"); layout replicado campo a campo (canhoto, cabeçalho emitente/DANFE/chave de acesso, destinatário/remetente, cálculo do imposto, dados dos produtos, dados adicionais), com selo "RASCUNHO — NÃO É DOCUMENTO FISCAL VÁLIDO" em destaque.
- Migration `20260716000001` adiciona `unique(pedido_id)` em `notas_fiscais` — fecha a corrida de duplo-clique/duas-abas criando duas notas pro mesmo pedido.
- Code-review de 5 ângulos aplicado; achados reais corrigidos: CSOSN interpolado sem validação no nome da tag XML (`<ICMSSN${csosn}>` quebraria o XML com um valor fora do padrão `\d{2,3}`), texto "validado"/"ainda não validado" invertido no rodapé do DANFE, `new Date().toISOString()` usado pra `dataEmissao` (mesma classe de bug de timezone já corrigida antes no Financeiro — trocado por horário de Brasília explícito), tela de conferência não recarregava os dados depois de salvar/validar (`router.refresh()` faltando), `marcarComoValidada` sem checagem de linhas afetadas (corrida entre dois cliques concorrentes), lógica de montagem do XML duplicada entre `gerarNotaFiscal`/`atualizarDadosFiscais` (extraída pra `montarDadosNfe`).
- Build e lint confirmados limpos.

## Documento mestre — detalhes

### Fase 1 — Fundação (concluída, 2026-07-20)

- `docs/architecture/money-handling.md`: decisão de dinheiro formalizada (`numeric(10,2)` sempre no banco, servidor sempre recalcula a partir dos itens, nunca confia no total pronto do cliente — já era o padrão, isso só documenta).
- Vitest instalado (`npm run test`), `src/lib/precificacao.ts` extraído e testado (multiplicador 2,8).
- `pending_decisions` (banco real): 11 ambiguidades do documento mestre, cada uma com `ativo=false` até decisão humana — 1 já resolvida e registrada (fusão do documento confirmada pelo usuário).
- `permissoes_usuario` + `tem_permissao()`: permissões granulares (16 ações sensíveis) estendendo os 4 papéis existentes, sem quebrar a RLS já em produção.
- `audit_log` + `registrar_auditoria()`: auditoria central, só gravável via function (nunca insert direto do cliente).
- Paleta oficial do documento mestre aplicada em `globals.css` (mesmos nomes de variável, valores novos) e sidebar (degradê vinho profundo → marrom vinho).
- Convenção de rollback (`-- ROLLBACK:` no cabeçalho) pras migrations novas a partir daqui — ver `supabase/README.md`.

### Fase 2 — Cadastros estendidos (concluída, 2026-07-20)

- `produtos` ganhou ~25 colunas novas (aditivo, nada quebrado): código de barras, referência, descrição, material, tipo de banho, pedra/pérola/resina/fita/fio/correntaria, fornitura, embalagem, relógio, coleção/última coleção, cor/tamanho/peso/gênero, tipo de garantia, marca gravada, fornecedor, custo de aquisição, cotação diária, preço promocional, CEST/CFOP padrão/CST/origem.
- `vendedores` (comissão %/fixa, evento gerador, meta) estendendo `profiles`.
- `condicoes_pagamento` + `faixas_parcelamento` (esta última criada na Fase 3): regras de parcelamento configuráveis por forma de pagamento, seed com os valores reais do documento (R$200→2x sem juros, R$300→3x sem juros).
- `locais_estoque` (loja, principal, mostruário, avarias, garantias, abatimentos, reservados, trânsito) com FK opcional em `produtos`/`movimentos_estoque`.
- Formulário de produto ganhou os novos campos comerciais, agrupados numa seção própria.

### Fase 3 — Núcleo do PDV (concluída, 2026-07-21)

- Novo status `aguardando_lancamento_gmax` (venda registrada no PDV, sem afetar estoque/financeiro até ser digitada manualmente no GMax) e `lancado_gmax` (já conferida) — formaliza como regra de negócio testável o que antes era cogitado como reaproveitar `orcamento` informalmente. Nova forma de pagamento `debito`, distinta de crédito.
- Desconto automático por forma de pagamento (dinheiro 10%/Pix 7%/débito 7%, sempre sobre a base elegível — fornitura nunca entra) e parcelamento por limiar de valor extraídos como funções puras testadas (`src/lib/desconto.ts`, `src/lib/parcelamento.ts`) e aplicados na tela de venda (`novo-pedido.tsx`).
- `criar_pedido` (v4): idempotência (`idempotency_key` — clique duplo/duas abas não duplicam a venda), `parcelas_planejadas` gravadas no próprio pedido (cupom/promissórias continuam imprimíveis sem depender de `contas_receber`), validação server-side de primeira compra (R$1000) e reativação (R$600 6-11 meses / R$800 12+ meses) com exceção só pra quem tem a permissão + justificativa, auditada.
- Navegação: Dashboard/Financeiro/Fiscal saem do menu, `/` redireciona pro PDV, que abre direto na aba de nova venda.

### Fase 4 — Regras especiais (concluída, 2026-07-21)

- Schema completo (aditivo) de abatimento, garantias, crediário legado, comissões, frete/expedição.
- Regras testadas como funções puras: base elegível/limite de 20% do abatimento, elegibilidade de peça, aprovação de garantia de folheado (descascamento ≥80%, aliança nunca aprovada), classificação de garantia de autenticidade, cálculo de comissão.
- `converter_cliente_em_crediario`/`lancar_crediario`/`receber_crediario`: só admin (conversão) ou usuário com a permissão granular correspondente, justificativa/recibo obrigatório, tudo auditado.
- UI funcional pros 5 sub-módulos: `/abatimentos` (avaliação com prévia de elegibilidade em tempo real, aprovar/reprovar), `/garantias` (formulário por tipo, prévia de aprovação pra folheado a ouro, decisão manual pra Orient/autenticidade), `/crediario` (converter cliente, lançar cobrança, receber em dinheiro), `/comissoes` (config por vendedor, lançamento manual com prévia), `/frete` (criar expedição a partir de pedido faturado/registrado, esteira completa de status).
- **Exceção registrada ao gate de mockup** (regra 1 do `CLAUDE.md`): todas as 5 telas novas desta fase foram construídas direto em código, sem Artifact/preview prévio, sob autorização explícita do usuário (`/goal` autônomo, "não precisa me perguntar nada"). Não é precedente — próximas telas novas com liberdade de design real voltam a exigir mockup.
- **Limitações resolvidas na leva seguinte (ver Fase 5):** geração automática de comissão e frete grátis automático, ambos implementados depois que as ambiguidades correspondentes foram decididas.

### Fase 5 — Relatórios e qualidade (núcleo funcional concluído, 2026-07-21)

- `/relatorios` (só admin): faturamento + variação vs. período anterior, vendas/ticket médio/cancelamentos, quebra por forma de pagamento, abatimentos e garantias aprovados/reprovados no período, estoque abaixo do mínimo, primeira compra no período, clientes inativos (6+ meses sem comprar), crediário em atraso (contagem + valor, via `situacaoEfetiva`), fretes grátis concedidos no período, comissões lançadas no período (contagem + total) — reaproveita os helpers de período já existentes (`src/lib/relatorios.ts`). Único indicador da seção 24 fora de escopo: taxas de cartão (schema não modela custo de maquininha como dado consultável — lacuna deliberada, documentada na própria tela).
- `criar_pedido` (v6): comissão gerada automaticamente no evento `venda` quando o vendedor autenticado tem config em `vendedores` com `evento_gerador='venda'` — fecha a pendência de "só lançamento manual".
- `/permissoes` (novo, só admin): UI de concessão/revogação das 16 permissões granulares por usuário (lista de usuários à esquerda, toggles das permissões à direita) — `conceder_permissao`/`revogar_permissao` (SECURITY DEFINER, auditadas). Fecha a limitação conhecida desde a Fase 4 de que só admin conseguia exercer qualquer ação protegida por `tem_permissao()`.
- As 10 ambiguidades do documento mestre (seção 27) decididas e implementadas — ver bloco dedicado abaixo.

**Code-review completo sobre as Fases 1-5** (`/code-review xhigh`, 10 ângulos, rodado em 2 rodadas — 8 agentes pararam por limite de sessão da conta na 1ª rodada, retomados com sucesso na 2ª). Achados reais corrigidos (lista consolidada das duas rodadas):
1. **Crítico:** uma correção anterior (migration de permissão/auditoria) reescreveu `extornar_pedido` e derrubou sem querer o bloqueio de "parcela já paga" que existia desde 2026-07-14 — extornar um pedido faturado com parcela já baixada no Financeiro voltou a apagar esse histórico de pagamento silenciosamente. Restaurado.
2. `aprovarAbatimento`/`reprovarAbatimento` e a decisão de garantia faziam UPDATE direto, sem checar a permissão granular específica nem gravar em `audit_log` — corrigido com 3 functions SQL novas.
3. `extornar_pedido`/`ajustar_valor_pedido` não bloqueavam pedido já `lancado_gmax` — corrigido.
4. `extornar_pedido` não limpava `parcelas_planejadas`, permitindo reimprimir promissórias de venda cancelada — corrigido.
5. `criar_pedido` não validava acréscimo negativo (funcionava como desconto não auditado) — validação adicionada + guarda no simulador de cartão com juros.
6. Corrida real de idempotência em `criar_pedido` (select-then-insert) — fechada com tratamento de `unique_violation`.
7. Justificativa vazia aceita nas aprovações de abatimento/garantia — uniformizado.
8. Botões de aprovar/reprovar apareciam pra vendedor sem ele poder ter a permissão (sem UI de concessão ainda) — ocultos pra não-admin; override manual de veredito automático de folheado a ouro (antes inalcançável) liberado.
9. Frete grátis não checava `conceder_frete_gratis` nem auditava — corrigido.
10. Comissão lançada confiava na taxa vinda do cliente em vez de reler do servidor — corrigido.
11. `crediario-view.tsx` nunca calculava "atrasado" dinamicamente — corrigido com `situacaoEfetiva`.
12. Filtro de período em `/relatorios` comparava timestamptz UTC direto contra data local — mesma classe de bug de fuso já corrigida antes no projeto, reintroduzida aqui — corrigido.
13. 4 usos de `new Date().toLocaleDateString/toLocaleString()` sem fuso explícito trocados pelos helpers do projeto.
14. Índices faltando em FKs consultadas de verdade; `condicoes_pagamento` sem linha de "debito"; reuso de `parseMoeda` não aproveitado; `percentual_descascamento` com `|| null` tratando 0% como vazio.

**Ambiguidades da seção 27 decididas (2026-07-21):** as 10 pendências do documento mestre foram todas decididas por instrução direta do usuário ("nada dessas perguntas, devem fazer parte do sistema") — ver `DECISIONS.md` pro contexto completo e `pending_decisions` (banco real) pra decisão + justificativa de cada uma. O que cada decisão implicou em código:
- **Primeira compra/prata 925 código≥20**: conta normalmente no total do mínimo; exposto como subtotal destacado no carrinho (`novo-pedido.tsx`), sem UI de teste de integração ainda.
- **Frete grátis automático (≥R$700, base = total do pedido)**: implementado em `criar_expedicao` — libera sozinho sem exigir permissão/auditoria (é regra determinística, não exceção); concessão manual abaixo do mínimo continua exigindo permissão + motivo + auditoria.
- **Pagamento misto**: forma de pagamento nova (`misto`), tabela `pedido_pagamentos_mistos`, `criar_pedido` (v7) valida que a soma das formas bate com o total; sem desconto automático (decisão: o documento veta inventar divisão proporcional). UI completa em `novo-pedido.tsx` (adicionar/remover formas, validação de soma).
- **Código Ventilador**: investigado nos 44 produtos migrados do GMax — sem evidência real de uso da cifra. Permanece não implementado.
- **Comissão do crediário**: automática no evento de recebimento (`receber_crediario`), via vendedor do pedido de origem quando existir.
- **Bloqueio de crediário por atraso**: > 5 dias (a partir do 6º dia), calculado dinamicamente (`crediarioBloqueadoPorAtraso` em `situacao-conta.ts`, testado) — nunca uma flag armazenada.
- **Medição de descascamento (garantia)**: confirmado que já era estimativa visual do atendente — sem mudança de código.
- **Destino do abatimento aprovado**: vai pro local "Abatimentos recebidos" (`aprovar_abatimento` agora seta `local_id` automaticamente).
- **Multiplicador ouro/cobre (cotação diária)**: tabela `cotacoes_diarias` + function `informar_cotacao` + card "Cotação do dia" em `/estoque` (permissão `informar_cotacao`) + `calcularPrecoPorCotacao` (testado) usado na tela de venda quando o produto usa cotação diária.
- **Abatimento não reduz base de desconto/frete**: confirmado — já eram fluxos separados, sem mudança de código.

**Achado de segurança (checagem leve, sem subagentes):** `registrar_auditoria` e `tem_permissao` nunca tiveram trava real de EXECUTE — o padrão já usado em ~15 migrations anteriores (`revoke all ... from public`) sempre foi um no-op, porque o Supabase concede EXECUTE direto a `anon`/`authenticated` (não via PUBLIC) em toda function nova. Como toda outra function protegida já checa permissão no próprio corpo, o risco prático ficou restrito a essas duas (`registrar_auditoria` não tinha checagem nenhuma — qualquer RPC, inclusive `anon` sem login, podia forjar uma linha de audit_log). Corrigido revogando das roles certas. Detalhes em `DECISIONS.md`.

**Ainda não feito:**
- Taxas de cartão como indicador de `/relatorios` — lacuna deliberada (schema não modela custo de maquininha como dado consultável).
- Geração automática de comissão nos eventos `fechamento_mensal` — só `venda` e `recebimento` foram automatizados.
- Testes de integração contra banco real (as regras implementadas em SQL têm `it.todo` registrado em `src/lib/regras-comerciais.pendente.test.ts`; as funções puras extraídas têm cobertura Vitest real).
- Higiene cosmética: o padrão de revoke ineficaz (achado de segurança acima) não foi corrigido nas ~15 migrations anteriores que também o usam — não é vulnerabilidade aberta (cada uma tem checagem própria), só inconsistência de estilo registrada.

## Pendências reais

- **Prints do toqMax** ainda não recebidos — não bloqueia nada crítico.
- **Reset da senha do banco** ainda recomendado (mesma senha reusada desde a Fase 2 original).
- **Fotos dos 44 produtos importados do GMax**: nenhuma tem foto ainda.
- **Provedor de NF-e** ainda não escolhido — o módulo Fiscal está pausado (fora do menu) por decisão do pivô, não bloqueado por isso.

## Próxima tarefa

Fase 5 está com o núcleo funcional completo (relatórios, comissão automática, permissões granulares com UI, frete grátis automático, pagamento misto, cotação diária). O que resta é decisão do usuário, não construção: prints do toqMax, reset de senha do banco, fotos dos produtos, e escolha de provedor de NF-e — nenhum bloqueia o uso real do PDV hoje.
