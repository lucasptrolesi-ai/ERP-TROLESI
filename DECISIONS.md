# DECISIONS — ERP Trolesi

Histórico de decisões de escopo e arquitetura, na ordem em que foram tomadas. Decisões revistas ficam marcadas como tal, não apagadas.

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

## 2026-07-13 — Fase 2 aplicada no projeto real

- Usuário criou o projeto `trolesi-erp` manualmente pelo dashboard (decisão de segurança: ele não compartilhou um token de acesso da conta, só as credenciais desse projeto específico).
- **Achado técnico:** a conexão direta do Postgres (`db.<ref>.supabase.co`) é IPv6-only por padrão em projetos novos do Supabase; o ambiente de execução só tem saída IPv4. Solução sem custo: usar o **Session Pooler** (`aws-1-sa-east-1.pooler.supabase.com`, porta 5432, usuário `postgres.<ref>`), que já é IPv4 por padrão — não precisou do complemento pago de "Endereço IPv4 dedicado" ($4/mês).
- A senha do banco foi compartilhada em texto no chat para viabilizar a aplicação das migrations — recomendado ao usuário resetá-la depois, já registrado em `PROJECT_STATUS.md`.
- 7 migrations aplicadas com sucesso; 10 tabelas, RLS em todas, 20 políticas — verificado por query direta ao catálogo do Postgres (`pg_class`, `pg_policies`), não só pela ausência de erro.

## 2026-07-13 — Fase 2 preparada sem provisionar Supabase real

- **Decisão:** as migrations SQL (schema completo + RLS) foram escritas e versionadas, mas **nenhum projeto Supabase foi criado**.
- **Motivo:** criar um projeto Supabase é uma ação em conta externa do usuário — não é algo que deva ser feito sem confirmação explícita, e não havia necessidade técnica de já existir para escrever/revisar o schema.
- **Impacto:** Fase 3 (scaffold Next.js) precisa decidir/confirmar se o ERP usa um projeto Supabase novo (separado do da landing page, recomendado por segregação de dados sensíveis) antes de aplicar as migrations de verdade.
