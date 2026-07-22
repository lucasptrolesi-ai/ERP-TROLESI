# CHANGELOG — ERP Trolesi

## 2026-07-22 (cont. 2) — Verificação final: dado sempre atualizado para todos

Pedido direto do usuário ("preciso que tudo seja atualizado para todos a todo momento") — auditoria de todas as 17 Server Actions do app em busca de dado que fica desalinhado entre telas ou pessoas, mais uma nova camada de atualização ao vivo entre terminais.

- **Bug financeiro real corrigido (o mais sério da leva):** `ajustar_valor_pedido` só bloqueava edição de desconto/acréscimo quando `numero_parcelas > 1`, mas uma venda no cartão de crédito **ou promissória em 1x** já gera `numero_parcelas = 1` e uma linha real em `contas_receber` (criada sempre que existe pelo menos 1 parcela, não só quando há mais de uma). Isso deixava "Salvar ajuste" liberado nesse caso — o total do pedido mudava, a parcela em `contas_receber` (o que o Financeiro de fato cobra) ficava com o valor antigo, dois lugares mostrando dois valores diferentes pro mesmo pedido.
- **Achado da revisão independente sobre a própria correção (ver abaixo):** a 1ª versão do fix fazia a checagem de `contas_receber` numa function `security invoker` — como a RLS dessa tabela só libera SELECT pra admin/financeiro, e quem mexe no PDV no dia a dia é o vendedor, a trava nunca disparava pra esse papel. Corrigido isolando a checagem numa function auxiliar nova `pedido_tem_registro_financeiro` (`security definer`, mesmo padrão de `meu_papel()`) que bypassa RLS de propósito só pra essa leitura booleana — e estendida pra também cobrir pagamento misto (`pedido_pagamentos_mistos`), que tinha o mesmo problema e não tinha sido notado na 1ª versão.
- **Lacunas de `revalidatePath` corrigidas** (dado editado numa tela ficava obsoleto em outra até um reload manual, achado por grep sistemático de toda mutação x toda leitura da mesma tabela): editar/desativar/excluir funcionário não atualizava `/permissoes` nem `/comissoes` (as duas leem `profiles`); editar/desativar/excluir cliente não atualizava `/abatimentos`, `/crediario`, `/garantias` nem `/relatorios`; editar/desativar/excluir fornecedor não atualizava `/financeiro`.
- **Supabase Realtime habilitado** (novo, não existia antes) em `produtos`, `pedidos`, `pedido_itens`, `contas_receber`, `contas_pagar` — a loja já fecha venda em vários aparelhos ao mesmo tempo (ver print-agent), então um terminal vendendo um produto agora atualiza o estoque, o PDV, o Financeiro e o sininho de vencimentos na tela de outro terminal sozinho, sem precisar de F5. Um único componente (`src/components/realtime-refresh.tsx`, montado uma vez no `AppShell`) assina as 5 tabelas com debounce de 400ms e chama `router.refresh()` — cobre a tela atual e o layout raiz numa tacada só. Realtime respeita as RLS já existentes (não muda quem vê o quê, só quando a tela se atualiza sozinha).
- Revisão feita por um subagente independente (a skill `/code-review` continua sendo só de invocação do usuário nesta conta — mesma limitação já registrada na sessão anterior) — achou o bug crítico de RLS acima antes de qualquer coisa ir pro ar, mais os 3 gaps de `revalidatePath` em `clientes.ts`/`fornecedores.ts`/`funcionarios.ts`. Confirmou como corretas: a semântica de `criar_pedido` que motivou o fix original, a ausência de overload duplicado na function, a segurança da migration de Realtime, e a limpeza/debounce do componente novo.
- Migrations novas: `20260722000005` (fix `ajustar_valor_pedido` + `pedido_tem_registro_financeiro`), `20260722000006` (habilita Realtime, idempotente). Build, lint e Vitest confirmados limpos.

## 2026-07-22 — Reconciliação GMax, paleta de cores, Financeiro de volta, cupom térmico

- **Reconciliação com o GMax real:** 38 pedidos de maio-julho ausentes do ERP importados diretamente da cópia do Firebird de produção (36 com itens/estoque/movimento completos, 2 só cabeçalho — sem DET no próprio GMax), 5 clientes e 2 produtos novos criados no processo. Um pedido de teste ("TESTE" #178) que estava poluindo os totais financeiros foi identificado e removido, com o estoque revertido corretamente.
- **Paleta rebrand:** navy/café + dourado champanhe substituindo o rosa original, a pedido do usuário ("atue como dev front-end sênior"), com contraste WCAG AA conferido manualmente em cada par de cor — achou e corrigiu um conflito real (`--color-rose-deep` servia dois papéis incompatíveis: texto escuro E fundo de botão claro) resolvido redirecionando os gradientes de botão pro par `gold-start/gold-end` já usado no botão GMax.
- **Financeiro de volta ao menu:** a tela (contas a receber/pagar, dar baixa, desfazer baixa, fechamento de caixa) já existia inteira desde antes do pivô pro PDV, só estava desvinculada da navegação — usuário pediu de volta pra quitar/estornar débitos. Ganhou também um botão "Extornar pedido" direto na lista de contas a receber (reaproveita a mesma action já usada em Pedidos), pra não precisar trocar de tela pra cancelar uma venda.
- **Cupom térmico reformulado:** de 80mm genérico pra 58mm real, com fluxo automático (via loja imprime sozinha ao fechar a venda, depois pergunta se quer a via cliente, igual maquininha de cartão).
- **Investigação de qualidade de impressão (a peça maior desta sessão):** o cupom saía borrado/fraco numa impressora térmica real (Elgin i8) mesmo depois de corrigir cor (preto puro em vez do `--color-ink` da marca) e peso de fonte — a causa raiz é estrutural: o navegador imprime HTML como imagem rasterizada, e uma térmica de 203dpi não reproduz bem texto anti-aliased. Resolvido construindo um **print-agent local** (`print-agent/`, Node puro sem dependências) que monta comandos ESC/POS nativos e manda direto pro spooler da impressora em modo RAW — mesma qualidade de um sistema nativo (GMax). 48 colunas úteis confirmadas fisicamente via teste de régua de caracteres na impressora real.
- **Arquitetura corrigida em campo:** a 1ª versão do agente esperava um `fetch()` direto do navegador pro loopback (`127.0.0.1`) da máquina do agente — só funcionaria se a venda fosse fechada naquela mesma máquina. Descoberto (usuário reportou "estou imprimindo do Mac") que a loja fecha venda de Mac, Windows e celular — reescrito pra fila via Supabase (`solicitacoes_impressao`): o navegador grava o pedido de impressão, o agente (rodando só onde a impressora está ligada) faz polling a cada ~2s e imprime, não importa de qual aparelho a venda saiu. Testado de ponta a ponta contra a infra real (inserção → captura pelo agente → impressão física confirmada por foto → status atualizado no banco) e confirmado funcionando a partir do Mac real do usuário.
- Duas rodadas de code-review (delegadas via subagente, já que a skill `/code-review` é só de invocação do usuário) encontraram e corrigiram achados reais em cada etapa: corrida de clique duplo sem guarda no fluxo de impressão, bug de auto-print nunca disparando em StrictMode (dev), policy de banco liberando qualquer papel a gravar solicitação de impressão (restrita a admin/vendedor/financeiro), agente sem handler de `unhandledRejection` (podia morrer silenciosamente).

## 2026-07-21 (cont. 4) — Deploy, recuperação/troca de senha, estoque negativo autorizado

- **Deploy:** site publicado em `https://erp-trolesi.vercel.app` (Vercel, Git integration ligada — todo push em `master` gera deploy automático, por decisão explícita do usuário).
- **Senha:** conta admin existente (`lucasptrolesi@gmail.com`) recuperada (senha resetada direto no banco, autorização explícita do usuário). Novo fluxo completo de recuperação de senha: `/esqueci-senha` (solicita link por e-mail) → `/redefinir-senha` (define nova senha a partir do link) — faltava desde a Fase 3. Nova tela `/conta` pra qualquer usuário logado trocar a própria senha a qualquer momento.
- **Estoque negativo autorizado:** `criar_pedido` não bloqueia mais uma venda por falta de estoque contado no sistema — a baixa acontece do mesmo jeito, podendo deixar o saldo negativo (decisão do usuário: venda pode acontecer antes da contagem/reposição ser atualizada). Removidos os bloqueios equivalentes no cliente (`novo-pedido.tsx`: adicionar produto sem saldo, aumentar quantidade além do disponível) — vira aviso informativo, não impedimento.

## 2026-07-21 (cont. 3) — As 10 ambiguidades do documento mestre + UI de permissões + achado de segurança

Por instrução direta do usuário ("nada dessas perguntas, devem fazer parte do sistema, a foto das regras é pra voce ter entendimento do funcionamento da loja"), as 10 ambiguidades da seção 27 do documento mestre foram decididas e implementadas nesta leva, em vez de ficarem paradas em `pending_decisions`. Cada decisão com sua razão está registrada no banco (`pending_decisions.decisao`) e em `DECISIONS.md`.

- **Primeira compra/prata 925 código≥20** (`novo-pedido.tsx`): conta normalmente no total do mínimo; subtotal exposto no carrinho quando presente.
- **Frete grátis automático** (`criar_expedicao`): libera sozinho a partir de R$700 (base = total do pedido), sem exigir permissão/auditoria — é regra determinística, não exceção. Concessão manual abaixo do mínimo continua exigindo permissão + motivo + auditoria.
- **Pagamento misto**: forma de pagamento nova (`misto`), tabela `pedido_pagamentos_mistos`, `criar_pedido` v7 valida soma == total, sem desconto automático. UI completa em `novo-pedido.tsx` (linhas de forma+valor, adicionar/remover, validação de soma); breakdown exibido em cupom e no detalhe do pedido.
- **Código Ventilador**: investigado nos 44 produtos migrados do GMax (CSV real) — sem evidência de uso. Permanece não implementado.
- **Comissão do crediário legado**: automática no recebimento (`receber_crediario`), via vendedor do pedido de origem.
- **Bloqueio de crediário por atraso > 5 dias**: calculado dinamicamente (`crediarioBloqueadoPorAtraso`/`diasDeAtraso` em `situacao-conta.ts`, com teste real) — bloqueia novo `lancar_crediario` e mostra badge na tela.
- **Medição de descascamento (garantia)**: confirmado que já era estimativa visual do atendente — decisão sem mudança de código.
- **Destino do abatimento aprovado**: `aprovar_abatimento` agora seta `local_id` pro local "Abatimentos recebidos" automaticamente.
- **Multiplicador ouro/cobre (cotação diária)**: tabela `cotacoes_diarias`, function `informar_cotacao`, card "Cotação do dia" em `/estoque`, `calcularPrecoPorCotacao` (testado) usado na venda quando o produto usa cotação diária, com aviso quando a cotação do dia não foi informada.
- **Abatimento não reduz base de desconto/frete**: confirmado — já eram fluxos separados.

**UI de concessão de permissões granulares** (`/permissoes`, novo): admin concede/revoga as 16 permissões especiais por usuário (lista de usuários + toggles), via `conceder_permissao`/`revogar_permissao` (SECURITY DEFINER, auditadas) — fecha a limitação de que só admin conseguia exercer qualquer ação protegida por `tem_permissao()`.

**Checagem leve de segurança (sem subagentes):** achado real — `registrar_auditoria` (SECURITY DEFINER sem checagem de permissão nenhuma) e `tem_permissao` nunca tiveram trava de EXECUTE de verdade. Descoberto ao investigar: o padrão `revoke all ... from public` usado em ~15 migrations anteriores sempre foi um no-op, porque o Supabase concede EXECUTE direto a `anon`/`authenticated` (não via PUBLIC) em toda function nova. `registrar_auditoria` era a única exploração real (qualquer RPC, inclusive sem login, podia forjar uma linha de audit_log) — corrigido revogando das roles certas. As outras ~15 functions não foram tocadas: cada uma já verifica permissão no próprio corpo, então o risco prático sempre foi zero ali; reescrever o revoke nelas é higiene cosmética, não correção de vulnerabilidade, e ficou fora do escopo desta checagem leve.

Migrations novas: `20260721000013` a `20260721000019` (permissões, resolução das 10 pendências, cotações diárias, frete grátis automático, pagamento misto — enum isolado numa migration própria por causa da restrição do Postgres de não usar um valor de enum na mesma transação em que foi criado —, e a correção de segurança). Todas aplicadas e verificadas em produção (`pg_proc`/`has_function_privilege` conferidos após cada uma).

Build, lint e suíte Vitest confirmados limpos (novos testes: `situacao-conta.test.ts`, extensão de `precificacao.test.ts`).

## 2026-07-21 (cont. 2) — Code-review completo (2ª rodada) + Fase 5: relatórios e comissão automática

- **Code-review dos 8 ângulos que faltavam** (`/code-review xhigh`, retomados após o limite de sessão da 1ª rodada) sobre as Fases 1-4: encontraram e corrigiram mais 9 problemas reais, o mais grave sendo uma regressão que o próprio processo desta sessão havia introduzido — `extornar_pedido` perdeu silenciosamente o bloqueio de "parcela já paga" (existente desde 2026-07-14) ao ganhar o bloqueio de `lancado_gmax` na correção anterior; restaurado com os dois bloqueios juntos. Outros achados: `criar_pedido` sem validação de acréscimo negativo (funcionava como desconto não auditado), corrida real de idempotência (select-then-insert), justificativa vazia aceita nas aprovações, botões de aprovar/reprovar visíveis pra quem nunca teria a permissão (sem UI de concessão ainda), veredito automático de garantia de folheado inalcançável pra revisão manual, frete grátis sem checar permissão nem auditar, comissão manual confiando na taxa client-side em vez de reler do servidor, `crediario-view` sem calcular "atrasado" dinamicamente, filtro de período de `/relatorios` reintroduzindo o bug de fuso horário UTC-vs-Brasília já corrigido antes em outros módulos, índices faltando em FKs consultadas de verdade.
- **Fase 5 concluída:** `/relatorios` ganhou os indicadores que faltavam (primeira compra no período, clientes inativos 6+ meses, crediário em atraso com valor, fretes grátis concedidos, comissões lançadas) — único indicador da seção 24 fora de escopo é taxas de cartão (lacuna deliberada, documentada na própria tela, schema não modela custo de maquininha como dado consultável). `criar_pedido` v6 passou a gerar comissão automaticamente no evento `venda` (recebimento/fechamento mensal continuam manuais).
- Build, lint e suíte Vitest confirmados limpos (42 testes reais, 19 `it.todo`).

## 2026-07-21 — Documento mestre: Fases 1-4 (fundação, cadastros, núcleo do PDV, regras especiais) + correções de code-review

Pivô de escopo grande: fusão com um documento mestre de regras comerciais de PDV/loja de joalheria trazido pelo usuário (ver `DECISIONS.md`), executado de forma autônoma (`/goal`) fase a fase, com commit e push a cada fase.

- **Fase 1 (fundação):** decisão de dinheiro documentada, Vitest instalado (`calcularPrecoUnitario` extraído e testado), `pending_decisions` (11 ambiguidades do documento, feature-flagged), `permissoes_usuario`/`tem_permissao()` (16 permissões granulares estendendo os 4 papéis), `audit_log`/`registrar_auditoria()` central, paleta oficial aplicada (mesmos nomes de variável CSS, valores novos), convenção de rollback pras migrations novas.
- **Fase 2 (cadastros estendidos):** produtos ganharam ~25 atributos comerciais (material, tipo de banho, pedra/pérola/fornitura/relógio/última coleção, garantia, custo de aquisição, CEST/CFOP/CST/origem etc.), `vendedores`, `condicoes_pagamento`, `locais_estoque` — tudo aditivo.
- **Fase 3 (núcleo do PDV):** status `aguardando_lancamento_gmax`/`lancado_gmax`, forma de pagamento `debito`, desconto automático por forma de pagamento e parcelamento por limiar de valor extraídos como funções puras testadas, `criar_pedido` v4 (idempotência, `parcelas_planejadas`, validação de primeira compra/reativação com exceção auditada), Dashboard/Financeiro/Fiscal saem do menu, PDV vira tela principal.
- **Fase 4 (regras especiais):** schema completo de abatimento/garantias/crediário legado/comissões/frete, regras testadas como funções puras (limite de 20% do abatimento, elegibilidade de peça, aprovação de garantia de folheado, classificação de autenticidade, cálculo de comissão), UI funcional pra abatimentos e garantias (exceção registrada ao gate de mockup — ver `DECISIONS.md`).
- **Code-review parcial** (`/code-review xhigh`, 10 ângulos — 8 pararam por limite de sessão da conta, retomar depois): os 2 que completaram encontraram e corrigiram 5 bugs reais — aprovação de abatimento/garantia sem checar permissão granular nem auditar (3 functions SQL novas: `aprovar_abatimento`/`reprovar_abatimento`/`aprovar_reprovar_garantia`), `extornar_pedido`/`ajustar_valor_pedido` não bloqueando pedido já `lancado_gmax`, reimpressão de promissória de venda cancelada (fallback de `parcelas_planejadas` não limpo no extorno), mais um `|| null` tratando 0% de descascamento como campo vazio (achado à parte) e reuso de `parseMoeda` não aproveitado.
- Build, lint e suíte Vitest confirmados limpos em cada fase (42 testes reais passando, 19 `it.todo` documentando regras pendentes de teste de integração).

## 2026-07-16 — Fase 4: Fiscal/NF-e (modo conferência)

- Módulo Fiscal completo em modo conferência: lista pedidos faturados sem nota, "Gerar XML" cria a nota com CFOP automático (5101 dentro de MG / 6101 fora, batendo com o histórico real do GMax), tela de conferência com XML + CFOP/natureza editáveis, "Marcar como validada".
- **DANFE printável reconstruído pra bater com o padrão visual real do GMax** — o usuário compartilhou uma DANFE real e pediu fidelidade; layout replicado campo a campo (canhoto, cabeçalho, chave de acesso, destinatário/remetente, cálculo do imposto, produtos, dados adicionais), com selo de rascunho em destaque.
- Migration `20260715000001` (NCM/CSOSN em produtos, CFOP/natureza/série em notas_fiscais) + patch pontual preenchendo NCM/CSOSN reais dos 44 produtos. Migration `20260716000001` adiciona `unique(pedido_id)` em `notas_fiscais` contra corrida de duplo-clique.
- Investigação prévia (a pedido do usuário) concluiu que não existe integração segura GMax↔Trolesi pra emissão — sem API suportada, sem layout documentado de pedidos no protocolo proprietário do GMax. Ver `DECISIONS.md`.
- Code-review de 5 ângulos aplicado; achados reais corrigidos: CSOSN sem validação interpolado no nome da tag XML, texto "validado"/"ainda não validado" invertido no DANFE, `toISOString()` usado pra `dataEmissao` (mesma classe de bug de timezone já corrigida antes), tela de conferência sem `router.refresh()` após salvar/validar, `marcarComoValidada` sem checagem de linhas afetadas, lógica de montagem do XML duplicada (extraída pra `montarDadosNfe`).
- Build e lint confirmados limpos.

## 2026-07-15 — Dashboard, fechamento de caixa e meta de faturamento

- Dashboard reescrito a partir do mockup já aprovado na Fase 1: KPIs (pedidos hoje, ticket médio, a receber em atraso/produtos ativos conforme papel, estoque baixo), faturamento do mês com barra de progresso até R$55 mil, pedidos recentes e estoque em alerta.
- Fechamento de caixa: nova terceira aba em Financeiro, período Diário/Semanal/Mensal com navegação ◀▶, faturamento + variação vs. período anterior, quebra por forma de pagamento, contas a receber/pagar do período, top produtos, tabela "Vendas do período" (cliente/valor/forma de pagamento, pedido explícito do usuário).
- Alerta de meta de R$55 mil/mês, mesmo padrão de `localStorage` do alerta de vencimentos.
- Extraídos `relatorios.ts` (agregações compartilhadas), `situacao-conta.ts`, `status-pedido.ts`, `kpi-card.tsx`.
- Code-review de 5 ângulos aplicado; achado real corrigido: `deslocarPeriodo` pulava fevereiro inteiro ao navegar a partir de 31/janeiro no modo mensal.
- Build e lint confirmados limpos.

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
