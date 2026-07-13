# DECISIONS — ERP Trolesi

Histórico de decisões de escopo e arquitetura, na ordem em que foram tomadas. Decisões revistas ficam marcadas como tal, não apagadas.

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
