<title>ERP Trolesi — Relatório de Status</title>

# ERP Trolesi — Relatório de Status
### Substituição do GMax/Sincron por um sistema web enxuto

---

## 1. Objetivo do projeto

Reprogramar o ERP que a Trolesi usa hoje (GMax, com a pasta "Sincron") como um sistema web mais **completo em funcionalidade mas mais simples de operar**, hospedado na nuvem. Premissa do próprio cliente: *"quantidade de linhas não significa qualidade"* — o alvo é um sistema enxuto, não um clone 1:1 do GMax.

Plano completo aprovado em: `C:\Users\Micro\.claude\plans\glowing-dreaming-music.md`

---

## 2. O que foi descoberto na análise (Fase 0)

### 2.1 GMax e "Sincron" são o mesmo sistema

"Sincron" não é um segundo ERP — é a pasta de trabalho do próprio GMax para sincronização de XML de NF-e. Confirmado lendo `SINCRON/TempXML.bat` e `GMax/Conexao.ini`, que aponta `BancoRede=SERVIDOR:\GMax\GMaxERP.FDB`.

O **toqMax** (perguntado na conversa) também faz parte do mesmo instalador — é o módulo de PDV/venda rápida do GMax, não um sistema separado. Não consegui abrir/inspecionar sua tela porque não tenho ferramenta de captura visual de aplicativos Windows; aguardando prints do usuário para alinhar o fluxo de venda do mockup.

### 2.2 Banco de dados real localizado e analisado

- Banco de produção: `erp trolesi/GMax/GMaxERP.FDB` (Firebird 2.5, ODS 11.1, ~30MB, em uso ativo)
- Toda a análise foi feita **sobre uma cópia** (`GMaxERP - Copia (2).FDB`), nunca o arquivo em produção
- **Nenhum software foi instalado no computador do usuário** — usei o pacote oficial "Firebird Embedded" (só DLLs, sem instalador/serviço) + Python, tudo descartável, rodando de uma pasta temporária

### 2.3 Volume real de dados — por que "enxuto" faz sentido

Das **570 tabelas** do schema, só **180 têm alguma linha** — e a maioria dessas é tabela de referência fiscal/geográfica que vem pronta de fábrica com o GMax (NCM, CIDADES, CFOP, CST, tabelas de folha de pagamento, SPED), **não dados da Trolesi**.

O uso real do negócio é bem pequeno:

| Entidade | Volume real |
|---|---:|
| Pessoas/clientes cadastrados | 97 |
| Produtos cadastrados no GMax | 44 |
| Pedidos/orçamentos | 184 (971 itens) |
| Parcelas a receber | 164 |
| NF-e emitidas (histórico total) | 22 |
| Usuários do sistema | 6 |
| Vendedores | 6 |
| Colaboradores | 5 |
| Empresas cadastradas | 1 |
| Locais de estoque | 1 |

Confirmação valiosa: as configurações do GMax (`Conexao.ini`) têm `MultiplicadorAtacado=2,8`, batendo exatamente com o multiplicador de preço já usado no projeto da landing page.

**46 tabelas de negócio real** foram exportadas para CSV e ficam salvas em `erp-trolesi-novo/migracao-dados/export_csv/` (mais um mapa completo de contagem de todas as 570 tabelas em `table_counts.json`). Essa pasta está no `.gitignore` — contém dados reais de clientes.

### 2.4 Arquivos sensíveis identificados

Certificado digital A1 (`.p12`) e chave (`.key`) usados para assinatura de NF-e. Nunca serão commitados ou expostos — sobem direto na plataforma do provedor de NF-e escolhido (Focus NFe), que já é homologado para custodiar esse tipo de arquivo com segurança.

---

## 3. Decisões de escopo confirmadas com o usuário

| Tema | Decisão |
|---|---|
| Módulos do MVP | Cadastros, Estoque + Produtos, Vendas/Pedidos, Financeiro, Fiscal/NF-e |
| Consignação / "maleta" | **Removida do escopo** (decisão revista em 12/07) — todo comprador é um Cliente comum, com cadastro, sem tipo "revendedora" separado |
| Produtos | As 791 fotos do catálogo (Google Drive, já mapeadas no projeto da landing page) serão **unificadas** com os produtos do GMax num cadastro único de estoque real |
| NF-e | Sistema **gera o XML/DANFE primeiro**, para o usuário validar (inclusive no validador Sintegra que ele já tem) — emissão real na SEFAZ só entra depois que a conferência bater com o GMax |
| Integração fiscal | Via provedor de API (**Focus NFe**) em vez de integração direta com a SEFAZ — mais enxuto, sem manter layout fiscal por conta própria |
| Migração de dados | Sim, dados reais migrados do GMax (não recomeçar do zero) |
| Usuários do sistema novo | Dono + funcionários internos, com papéis diferentes (admin/vendedor/financeiro/estoque) |
| Stack | Next.js + Supabase (Postgres/Auth/Storage) + Vercel — mesma linha do projeto da landing page |

---

## 4. Estado atual por fase

| Fase | Status |
|---|---|
| 0 — Extração de dados reais do GMax | ✅ Concluída |
| 1 — Mockup das telas principais | 🔶 Em andamento — aguardando aprovação final |
| 2 — Schema Supabase + Auth/RBAC | ⏳ Não iniciada |
| 3 — Scaffold Next.js + login | ⏳ Não iniciada |
| 4 — Implementação módulo a módulo | ⏳ Não iniciada |
| 5 — Importação dos dados reais | ⏳ Não iniciada |
| 6 — Conferência fiscal (XML vs. GMax) | ⏳ Não iniciada |
| 7 — Deploy + liberação da emissão fiscal real | ⏳ Não iniciada |

### Mockup atual (Fase 1)

Publicado em: **https://claude.ai/code/artifact/859fb86e-0209-4672-b94e-3b0e5453af1e**

Seis telas navegáveis, usando a identidade visual real da Trolesi (rosa `#d46d82`, dourado, Cormorant Garamond + Montserrat):

1. **Dashboard** — KPIs do dia + pedidos recentes + alerta de estoque baixo
2. **Cadastros** — Clientes, Fornecedores, Funcionários
3. **Produtos & Estoque** — catálogo com foto, categoria, preço calculado (2,8×), status de estoque
4. **Pedidos** — lista de pedidos + tela **"Novo Pedido"** (buscar cliente cadastrado, adicionar produtos com qtd./preço/subtotal, escolher forma de pagamento — à vista 7% desconto ou cartão 3x —, total calculado, salvar como orçamento ou faturar)
5. **Financeiro** — contas a receber/pagar com status de atraso
6. **Fiscal/NF-e** — fluxo em 4 passos (pedido faturado → XML gerado → conferência → autorizar emissão), com prévia de XML

---

## 5. Pendências — aguardando você

- [ ] **Prints da tela de venda do toqMax** (e fechamento, se tiver) — para alinhar o fluxo de "Novo Pedido" ao que a equipe já conhece
- [ ] **Aprovação final do mockup** (ou mais ajustes) antes de eu avançar para o schema do banco (Fase 2) — nenhum código de sistema é escrito até esse gate ser liberado

---

## 6. Onde as coisas estão salvas

| O quê | Onde |
|---|---|
| Plano completo aprovado | `C:\Users\Micro\.claude\plans\glowing-dreaming-music.md` |
| Mockup (HTML) | `erp-trolesi-novo/design/mockup.html` |
| Dados reais exportados (46 tabelas, CSV) | `erp-trolesi-novo/migracao-dados/export_csv/` |
| Mapa de contagem de todas as 570 tabelas | `erp-trolesi-novo/migracao-dados/table_counts.json` |
| Proteção de dados sensíveis | `erp-trolesi-novo/.gitignore` (bloqueia `*.FDB`, dados exportados, `.env*`) |
