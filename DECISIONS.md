# DECISIONS — ERP Trolesi

Histórico de decisões de escopo e arquitetura, na ordem em que foram tomadas. Decisões revistas ficam marcadas como tal, não apagadas.

## 2026-07-14 — Fase 4: Financeiro + alerta de vencimentos, exceção ao gate de mockup

- **Exceção deliberada ao gate de mockup** (regra 1 do `CLAUDE.md`: "Nenhuma tela vira código de aplicação sem aprovação visual prévia"): o alerta de vencimentos (sininho + popup "contas vencendo hoje/próximos dias", com opção de dispensar por hoje) foi construído direto em código, sem passar por Artifact/preview antes. Motivo: o usuário especificou o comportamento inteiro em texto (câmera, sobreposição de tela, opção de não mostrar de novo mas de fácil acesso) e testou ao vivo no dev server logo depois — a aprovação aconteceu via teste real em vez de mockup estático, igual ao padrão já usado nas mudanças incrementais de Pedidos (parcelamento, extornar/ajustar) que também não passaram por um novo Artifact. Acho isso aceitável pra ajustes pontuais bem especificados pelo usuário; mockup completo continua obrigatório pra telas novas construídas com liberdade de design da minha parte. Achado pelo code-review, registrado aqui por transparência, não corrigido retroativamente (o usuário já testou e confirmou "TESTADO").
- **Situação de conta (`em_dia`/`atrasado`) é sempre recalculada na leitura, nunca confiada no valor gravado:** o enum `situacao_conta` do banco não tem trigger nem cron pra virar `atrasado` sozinho quando o vencimento passa — em vez de criar esse job, a UI computa "atrasado" comparando vencimento com a data de hoje toda vez que renderiza, e só confia no banco pro estado `pago` (que é sempre um evento explícito, o usuário clicando "marcar como pago"). Mais simples que manter um cron de virada de estado, e não pode ficar dessincronizado.
- **`extornar_pedido` agora bloqueia se alguma parcela já foi marcada como paga no Financeiro** (migration `20260714000003`): antes de existir a tela de baixa manual, apagar as `contas_receber` de um pedido extornado era seguro (nenhuma delas podia estar "paga" ainda). Assim que o Financeiro ganhou o botão "marcar como pago", extornar um pedido com parcela já paga passou a apagar silenciosamente esse histórico de recebimento — achado pelo code-review antes de ir pra produção, corrigido bloqueando o extorno nesse caso (mesmo padrão de guarda já usado em `ajustar_valor_pedido` pra pedidos com parcelas geradas).
- **Alerta de contas a pagar só pro admin, contas a receber pra admin+financeiro:** pedido explícito do usuário — o papel financeiro não precisa ser avisado de contas a pagar (RLS da tabela `contas_pagar` libera os dois papéis pra tela do Financeiro em si, mas o alerta automático é mais restrito por decisão de produto, não de segurança).

## 2026-07-14 — Fase 4: Pedidos, achado crítico de segurança e correção

- **Bug de segurança real, não hipotético:** as functions `SECURITY DEFINER` `criar_pedido`/`extornar_pedido` (migrations `20260713000014`/`20260714000001`) checavam papel com `if meu_papel() not in ('admin','vendedor') then raise exception ...`. Em SQL, `NULL NOT IN (...)` avalia para `NULL`, e o `IF` do PL/pgSQL trata condição `NULL` como falsa — ou seja, quando `meu_papel()` retornava `NULL` (sessão sem perfil, inclusive não-autenticada), a exceção nunca disparava e a function seguia com privilégio total. Encontrado por um agente de code-review focado em segurança, não por mim proativamente nem pelo usuário.
- **Correção:** migration `20260714000002` criou `assert_papel()`, um helper `SECURITY DEFINER` com checagem NULL-safe explícita (`if v_papel is null or not (...) then raise exception`), usado pelas três functions sensíveis. Também revogado o `EXECUTE` público (padrão do Postgres concede a `PUBLIC`) e concedido só a `authenticated`, como defesa em profundidade além da checagem de papel.
- **Validado com exploit real**, não só leitura de código: uma chamada HTTP direta ao endpoint RPC do Supabase sem nenhuma sessão (só a `apikey` pública) retornava sucesso antes da correção e passou a retornar `400 Sem permissão para esta ação.` depois. Nenhum dado real foi criado durante o teste (o payload usava UUIDs inexistentes, que a checagem de papel barra antes mesmo de chegar lá).
- **Desconto/acréscimo manuais em vez de desconto automático de 7% "à vista":** uma primeira versão da tela de Pedidos aplicava 7% de desconto automático para pagamento à vista — o usuário rejeitou explicitamente ("não quero desconto automático, quero poder digitar o valor que eu quiser") e o fluxo virou dois campos manuais (% e R$, sincronizados) sem nenhuma regra automática de desconto por forma de pagamento.
- **Extornar + ajustar em vez de editar/apagar direto:** pedidos já criados não podem ser editados livremente nem apagados — só "extornados" (cancela, devolve estoque se faturado, apaga as parcelas geradas) ou têm o valor "ajustado" (reescreve desconto/acréscimo e recalcula o total). Motivo: manter rastro de auditoria e não deixar o histórico de vendas com furos silenciosos. Pedidos com parcelas já geradas (cartão/promissória) não podem mais ser ajustados — têm que ser extornados e recriados — pra não desalinhar o valor das parcelas já registradas em `contas_receber` do valor total do pedido.
- **Cartão 4-12x como "simulador", não parcela editável individualmente:** a primeira versão permitia editar cada parcela do cartão manualmente; o usuário pediu pra simplificar para um único campo "valor total já com o juros da maquininha", que divide igualmente só pra exibição — motivo: na prática o valor que importa é o total cobrado pela maquininha, não uma distribuição arbitrária por parcela.

## 2026-07-14 — Fase 4: Estoque, "custo" não é custo

- **Renomeado `custo` → `codigo_peca`** no meio da construção do módulo, depois do usuário corrigir: o campo não representa custo de aquisição, é um valor/código base que multiplicado por 2,8 (o mesmo multiplicador de atacado já confirmado no projeto da landing page e na Fase 2) gera o preço de venda direto. Rotular como "Custo (R$)" no formulário estava semanticamente errado e podia enganar alguém tentando calcular margem real no futuro. Migration de rename aplicada sem perda de dado (Postgres preserva a expressão da coluna gerada `preco` através do rename).
- **`codigo_interno` como campo separado de `codigo_peca`**, a pedido do usuário ("assim como no PDV, eu consiga procurar por esse código") — decisão de design minha dentro do espaço que ele deixou aberto ("ou outro meio que você ache válido"): único quando preenchido (mesmo padrão do `cpf_cnpj` em clientes), mas não obrigatório, já que nem todo produto precisa de um código definido desde o cadastro inicial.
- **Toggle de "ativo" vira um checkbox dentro do próprio formulário de produto**, não uma ação separada de clique-rápido na grade (diferente do padrão usado em Clientes/Fornecedores, que tem botão "Ativar/Desativar" na lista). Motivo: Estoque é uma grade de cards com foto, não uma tabela de linhas — não há um lugar natural pra um segundo botão de ação por card sem poluir o layout. Editar já é uma ação de um clique (clicar no card), então colocar o toggle dentro do formulário não adiciona fricção real.

## 2026-07-13 — Fase 4: Cadastros completo, com exceção deliberada à ordem dos módulos

- **Cliente ganhou ficha completa da Receita Federal** (razão social, nome fantasia, situação cadastral, data de abertura, natureza jurídica, porte, atividade principal), a pedido explícito do usuário ("preciso que apareça todas as informações do CNPJ na ficha cadastral"). Nem todos esses campos aparecem em telas além do formulário de edição hoje — aceito conscientemente, não é esquecimento; revisar se algum se mostrar inútil na prática.
- **Nome do cliente usa razão social, não nome fantasia**, quando vem de busca automática — o usuário corrigiu isso depois de ver "SOLMI JOIAS" (nome fantasia) em vez de "JOSE LIBERIO DA SILVA" (razão social, o nome legal correto).
- **Busca de CNPJ com duas fontes (BrasilAPI + ReceitaWS)**, não uma só. Motivo: a BrasilAPI sozinha não encontrou um CNPJ de MEI aberto há ~1 mês (roda sobre um dump periódico da Receita, não dado ao vivo); a ReceitaWS tinha o dado. ReceitaWS entra só como fallback (tem limite de taxa mais apertado), nunca como fonte primária.
- **Exceção deliberada à regra "um módulo por vez":** a tela de Pedidos (`src/app/(app)/pedidos/`) ganhou uma fatia mínima — busca de cliente + cadastro rápido, reaproveitando o `ClienteForm` de Cadastros — antes do módulo de Estoque, que é o próximo na ordem do plano. Isso foi um pedido explícito do usuário ("preciso que tenha também um cadastro rápido de cliente na página de pedidos... que tecnicamente é meu PDV"), não uma decisão unilateral de pular a ordem. Nenhuma lógica de venda de verdade (produtos, carrinho, pagamento) foi implementada — a tela deixa isso explícito pro usuário. O código-review sinalizou isso como um desvio da regra do CLAUDE.md; mantido por ser exceção pontual e consciente, não um padrão a repetir.
- **Excluir (hard delete) além de desativar:** a pedido do usuário, além do soft-delete (`ativo=false`) já existente, `clientes`/`fornecedores` agora podem ser excluídos de verdade. Como as duas tabelas têm FKs com `ON DELETE RESTRICT` vindas de `pedidos`/`contas_receber`/`contas_pagar`/`notas_fiscais` (Fase 2), a exclusão tenta primeiro e, se o banco recusar (código Postgres 23503), mostra uma mensagem pedindo pra desativar em vez de excluir — não uma checagem prévia manual.

## 2026-07-11 — Escopo inicial

- **Módulos do MVP:** Cadastros, Estoque + Produtos, Vendas/Pedidos + Consignação, Financeiro. *(Consignação revista em 2026-07-12, ver abaixo.)*
- **NF-e no MVP** (revisão de uma decisão anterior de deixar de fora): sistema gera XML/DANFE para conferência primeiro; emissão real na SEFAZ só depois que o usuário validar contra o GMax e o validador Sintegra que ele já possui.
- **Integração fiscal via provedor de API** (Focus NFe), não integração direta com a SEFAZ — motivo: assinatura digital, protocolo, contingência e layout por estado mudam com frequência; um provedor especializado é mais enxuto que manter isso por conta própria.
- **Migração de dados real** confirmada (não recomeçar do zero) — motivo: dados de negócio já existem e têm valor (histórico de clientes, pedidos).
- **Usuários:** dono + funcionários internos, com papéis diferentes (não é um sistema single-user).
- **Stack:** Next.js + Supabase + Vercel — mesma linha do projeto da landing page da Trolesi, para reaproveitar conhecimento e conta.

## 2026-07-11 — Achados técnicos que mudaram o desenho

- GMax e "Sincron" **não são dois sistemas** — Sincron é a pasta de sincronização de XML de NF-e do próprio GMax. Não há um segundo ERP para migrar.
- Do schema de 570 tabelas do GMax, só 180 têm dado real, e a maioria dessas é referência fiscal/geográfica de fábrica (não dado da Trolesi). Uso real do negócio é pequeno (dezenas a centenas de registros por tabela, não milhares) — confirma que um clone completo do GMax seria desperdício de esforço.
- Certificado digital A1 e chave encontrados nos arquivos do GMax — necessários agora que NF-e entrou no escopo; decisão: nunca armazenar em texto puro ou git, sempre subir direto na plataforma do provedor de NF-e.
- Multiplicador de atacado 2,8× confirmado nas configurações reais do GMax (`Conexao.ini`), batendo com o valor já usado no projeto da landing page — validou a fonte de dados.

## 2026-07-12 — Consignação removida do escopo

- **Decisão:** o conceito de "revendedora" com consignação/maleta foi removido do MVP. Todo comprador é um `cliente` comum, com cadastro — sem tipo especial, sem controle de peças em consignação, sem comissão sobre consignado.
- **Motivo:** o usuário identificou, ao revisar o mockup v1, que a necessidade real e imediata é uma tela de venda direta para clientes cadastrados — não o fluxo de consignação que havia sido assumido inicialmente a partir do modelo de negócio "atacado para revendedoras".
- **Impacto:** tela "Cadastros" simplificada para só "Clientes" (sem aba de tipo); nova tela "Novo Pedido" desenhada (busca cliente → adiciona produtos → forma de pagamento → total → salvar orçamento ou faturar); tabela `consignacoes`/`comissoes` removida do modelo de dados do plano.
- Consignação pode voltar como módulo futuro se o usuário pedir — não foi descartada por ser desnecessária para sempre, só fora do MVP atual.

## 2026-07-13 — Unificação do catálogo de produtos

- **Decisão:** os 791 itens fotografados do catálogo (Google Drive, projeto da landing page) e os 44 produtos cadastrados no GMax serão unificados num único cadastro de estoque real, com controle de quantidade individual por item.
- **Motivo:** o usuário confirmou que quer controle de estoque de verdade sobre o catálogo completo, não um catálogo visual separado do estoque formal.
- **Impacto:** a Fase 5 (importação) precisa cruzar `PRODUTO`/`PRODUTO_EMPRESA`/`TABELA_PRECO_PRODUTO` do GMax com `catalog-manifest.json` da landing page — mapeamento ainda não desenhado em detalhe, fica para quando a Fase 5 começar.

## 2026-07-13 — Fase 3: Next.js 16 e sem tela de auto-cadastro

- **Next.js 16** foi usado (não 14 como o plano original mencionava) porque é o que `create-next-app@latest` instalou — o pacote inclui um aviso próprio ("This is NOT the Next.js you know") por causa de breaking changes reais: `cookies()` assíncrono e o arquivo `middleware.ts` renomeado para `proxy.ts`. Ambos aplicados corretamente, verificados contra a documentação embutida em `node_modules/next/dist/docs/` antes de escrever o código, não por suposição.
- **Sem tela pública de auto-cadastro.** Only login foi implementado — o primeiro usuário e os demais (só 6 no total, por decisão já registrada) são criados manualmente pelo admin via Supabase Dashboard. Motivo: ferramenta interna, uma tela de signup público seria superfície de ataque desnecessária para o tamanho da equipe.
- **Papéis mapeados como string literal (`Record<string, string>`), não com tipos gerados do Supabase.** Decisão consciente de não rodar `supabase gen types` nesta fase — com 4 papéis fixos e estáveis, o custo de manter geração de tipos não compensa ainda; registrado como possível melhoria futura, não esquecido por omissão.

## 2026-07-13 — Fase 2 aplicada no projeto real

- Usuário criou o projeto `trolesi-erp` manualmente pelo dashboard (decisão de segurança: ele não compartilhou um token de acesso da conta, só as credenciais desse projeto específico).
- **Achado técnico:** a conexão direta do Postgres (`db.<ref>.supabase.co`) é IPv6-only por padrão em projetos novos do Supabase; o ambiente de execução só tem saída IPv4. Solução sem custo: usar o **Session Pooler** (`aws-1-sa-east-1.pooler.supabase.com`, porta 5432, usuário `postgres.<ref>`), que já é IPv4 por padrão — não precisou do complemento pago de "Endereço IPv4 dedicado" ($4/mês).
- A senha do banco foi compartilhada em texto no chat para viabilizar a aplicação das migrations — recomendado ao usuário resetá-la depois, já registrado em `PROJECT_STATUS.md`.
- 7 migrations aplicadas com sucesso; 10 tabelas, RLS em todas, 20 políticas — verificado por query direta ao catálogo do Postgres (`pg_class`, `pg_policies`), não só pela ausência de erro.

## 2026-07-13 — Fase 2 preparada sem provisionar Supabase real

- **Decisão:** as migrations SQL (schema completo + RLS) foram escritas e versionadas, mas **nenhum projeto Supabase foi criado**.
- **Motivo:** criar um projeto Supabase é uma ação em conta externa do usuário — não é algo que deva ser feito sem confirmação explícita, e não havia necessidade técnica de já existir para escrever/revisar o schema.
- **Impacto:** Fase 3 (scaffold Next.js) precisa decidir/confirmar se o ERP usa um projeto Supabase novo (separado do da landing page, recomendado por segregação de dados sensíveis) antes de aplicar as migrations de verdade.
