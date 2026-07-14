# CHANGELOG — ERP Trolesi

## 2026-07-14 (cont. 4) — Financeiro: baixa de títulos completa

- Modal de baixa (contas a receber e a pagar) agora registra data real do pagamento, valor efetivamente recebido (pode diferir do valor da parcela — desconto de quitação ou juro/multa), forma de pagamento usada na baixa (separada da forma prevista do pedido) e observação livre.
- Contas a receber reorganizada: agrupada por cliente (ordenada pelo mais atrasado primeiro), filtros por situação (Todos/Atrasados/Em dia/Pagos), seleção múltipla (checkbox global e por cliente) com baixa em lote.
- Baixa em lote roda como um `UPDATE` atômico só via function no Postgres (`dar_baixa_em_lote_contas_receber`, migration `20260714000005`) — corrige um risco real de baixa parcial/corrida encontrado no code-review (loop de updates um por um sem transação).
- Corrigido bug de "Invalid Date" na data de pagamento (`pago_em` é `timestamptz`, formatador tratava como se fosse só data) e passou a gravar a data escolhida ancorada ao meio-dia de Brasília, evitando virar o dia errado por fuso.
- Code-review de 5 ângulos aplicado; build e lint confirmados limpos.

## 2026-07-14 (cont. 3) — Fase 5: importação dos dados reais do GMax

- Script `migracao-dados/importar_dados_reais.py` (modo relatório + modo execução) importou pro Supabase real: 51 clientes, 44 produtos, 172 pedidos históricos (949 itens) e 160 contas_receber, numa transação só.
- Achado durante a importação: 37 registros de `PESSOA` no GMax (tributos, correios, concessionárias, sindicatos etc.) vinham marcados como cliente de fábrica mas nunca tiveram um pedido real — filtrados fora.
- Preço dos produtos recalculado (código = valor de venda ÷ 2,8) batendo com o preço real do GMax; estoque negativo do sistema antigo zerado; fotos do catálogo da landing page (791) ficaram fora desta importação por falta de chave de junção confiável.
- Dados de teste anteriores apagados do banco antes da importação real.

## 2026-07-14 (cont. 2) — Fase 4: Financeiro + alerta de vencimentos

- Módulo Financeiro completo: contas a receber (alimentadas por Pedidos), contas a pagar (CRUD manual), baixa ("marcar como pago"/"desfazer") nas duas, KPIs (a receber/a pagar em 30 dias, recebíveis em atraso), acesso restrito a admin/financeiro com mensagem explícita pra quem não tem permissão.
- Alerta de vencimentos: sininho no cabeçalho com contador, popup automático (contas a receber vencendo hoje/próximos 2 dias pra admin+financeiro, contas a pagar só pra admin) ao entrar no sistema, com "não mostrar novamente hoje" (persistido no navegador) e reabertura sob demanda pelo sininho.
- **Bug de timezone corrigido** (`src/lib/datas.ts`): `hojeIso()`/`isoEmDias()` usavam `toISOString()` (sempre UTC) em vez do fuso de Brasília — entre ~21h e 23h59 locais, "hoje" já virava o dia seguinte, categorizando contas como atrasadas cedo demais e sumindo do alerta "vencendo hoje". Corrigido com `Intl.DateTimeFormat` fixado em `America/Sao_Paulo`. Achado por 3 agentes de code-review independentes.
- **`extornar_pedido` corrigido** (migration `20260714000003`): passou a bloquear o extorno quando o pedido tem parcela já marcada como paga no Financeiro — antes apagava esse histórico de recebimento junto com as parcelas em aberto, sem aviso.
- Outras correções do code-review: erro da baixa engolido silenciosamente (agora aparece no botão); `revalidatePath` não invalidava o layout raiz onde mora o alerta (sininho ficava com contagem velha); queries sequenciais no layout raiz paralelizadas; `marcarContaReceberPaga`/`marcarContaPagarPaga` consolidadas numa função interna só; cast de embed do Supabase centralizado em `src/lib/supabase-embed.ts`; duplicações de helper de data removidas (`novo-pedido.tsx`, cupom).
- Exceção registrada em `DECISIONS.md`: o alerta de vencimentos não passou por Artifact/preview antes de virar código (especificação detalhada do usuário + teste ao vivo serviram de aprovação).
- Code-review de 5 ângulos aplicado; build e lint confirmados limpos.

## 2026-07-14 (cont.) — Fase 4: Pedidos

- Módulo de Pedidos completo: venda com busca/cadastro rápido de cliente, carrinho de produtos limitado ao estoque, campo de "código da peça" editável por linha (recalcula preço = código × multiplicador na hora), desconto/acréscimo manuais (% ou R$), 4 formas de pagamento (dinheiro, Pix, cartão de crédito 1-12x, promissória até 4x).
- Cartão 4-12x: campo único "valor total já com o juros da maquininha" funciona como simulador, dividindo em parcelas iguais (última parcela absorve o resto do arredondamento) só pra exibição — não parcela editável uma a uma.
- Extornar pedido (cancela, devolve estoque se faturado, apaga contas a receber) e ajustar valor (reescreve desconto/acréscimo e recalcula total) acessíveis por um modal de detalhe, aberto clicando na linha do pedido na lista.
- Cupom térmico 80mm e notas promissórias A4 imprimíveis, reproduzindo o modelo físico real do TOQ Max, com valor e data por extenso em português (`src/lib/extenso.ts`).
- **Correção crítica de segurança:** `criar_pedido`/`extornar_pedido` (functions `SECURITY DEFINER`) tinham uma checagem de papel NULL-unsafe (`NULL NOT IN (...)` avalia `NULL`, `IF` trata como falso) que deixava qualquer sessão sem perfil — inclusive não-autenticada — chamá-las sem checagem nenhuma. Corrigido na migration `20260714000002` com um helper `assert_papel()` NULL-safe e revogação do `EXECUTE` público. Validado com uma chamada HTTP real sem sessão (sucesso antes → `400 Sem permissão` depois). Ver `DECISIONS.md`.
- Outras correções da mesma migration: parcelas (`contas_receber`) não são mais geradas para pedidos em status "orçamento"; nova checagem servidor-side de que a soma das parcelas bate com o total do pedido; corrida entre extornar e ajustar fechada com `for update`; ajustar bloqueado em pedidos que já têm parcelas geradas.
- Correções client-side descobertas no teste ao vivo com o usuário: juros do cartão não entravam no total exibido na tela (só no cálculo de salvar) — corrigido pra exibir o valor real a pagar com uma linha "Juros do cartão"; drift de arredondamento na última parcela; guarda de confirmação antes de finalizar pedido de R$0,00; edge case de `extenso.ts` quando os centavos arredondavam pra 100.
- Duplicações extraídas: `src/lib/parse-moeda.ts` (8 ocorrências), `src/lib/forma-pagamento.ts` (`FORMA_LABEL`, 2 ocorrências), `const editavel` em `pedido-detalhe.tsx` (3 ocorrências).
- Code-review de 8 ângulos aplicado em duas rodadas (a segunda focada em segurança e nos achados client-side pós-migração).
- Build e lint confirmados limpos.

## 2026-07-14 — Fase 4: Estoque

- Módulo de Estoque completo: CRUD de produtos (criar, editar, ativar/desativar, excluir com proteção contra erro de FK), grid com foto/categoria/preço/status de estoque, busca e filtro por categoria.
- Campo renomeado de `custo` para `codigo_peca` (migration `20260713000010`) depois do usuário corrigir: não é custo monetário, é o valor base que × 2,8 gera o preço de venda.
- Novo campo `codigo_interno` (migration `20260713000011`): código curto opcional e único pra busca rápida tipo PDV, separado do código da peça.
- Extraído pra reuso: `formatar-moeda.ts`, `permissoes.ts` (centraliza checagem de papel→permissão), `FormField` ganhou `onChange`/`min`/`max`/`list`.
- Code-review de 8 ângulos aplicado: busca não incluía categoria, campos numéricos sem clamp de faixa, `multiplicador` explícito zero sendo trocado por 2,8 (bug clássico do `||` com falsy), toggle de "ativo" inexistente apesar da mensagem de erro mandar desativar.
- Build e lint confirmados limpos.

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
