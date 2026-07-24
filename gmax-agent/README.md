# Agente local de importação GMax — ERP Trolesi

Programinho que roda só neste PC (o mesmo onde o print-agent já roda hoje —
SERVIDOR, a máquina que também tem o `GMaxERP.FDB` localmente) e resolve as
vendas lançadas direto no GMax (fora do PDV do Trolesi) contra o catálogo já
existente no Trolesi, pra você revisar e confirmar a importação pela tela
`/gmax` do sistema.

## Por que existe

O Trolesi ERP roda na nuvem (Vercel) e não enxerga o arquivo/rede da loja —
mesmo problema já resolvido antes pro cupom térmico (ver `print-agent/`). Em
vez de imprimir, este agente lê o Firebird do GMax e escreve um relatório
resolvido de volta pro Supabase.

**Este agente nunca grava pedido, cliente ou baixa de estoque direto** — só
lê o GMax e o Trolesi, resolve o que der (cliente por CPF/CNPJ, produto por
nome, forma de pagamento por uma tabela fixa), e relata. Quem grava de
verdade é o próprio Next.js (função SQL `importar_pedidos_gmax`), só depois
que um admin revisa a prévia na tela e confirma. Mantém toda escrita
financeira dentro do app principal (auditável, versionado), em vez de
espalhar lógica de negócio pro script que roda sem supervisão numa loja.

## Como funciona

1. Você clica "Buscar vendas novas do GMax" na tela `/gmax` do Trolesi —
   isso grava uma linha pendente em `solicitacoes_importacao_gmax`.
2. Este agente fica checando essa tabela a cada ~5s
   (`INTERVALO_POLLING_MS`).
3. Ao achar uma pendente: copia `GMaxERP.FDB` pra um arquivo temporário
   (**nunca lê o arquivo ao vivo** — mesma regra do resto do projeto),
   lê os pedidos com status "recebido"/"faturado" que ainda não foram
   importados, resolve cliente/produto/forma de pagamento/parcelas contra o
   Trolesi, e apaga a cópia temporária.
4. Se tudo resolver: marca a solicitação como `pronto_para_revisao` com o
   relatório — a tela mostra uma prévia (cliente, forma de pagamento,
   total, itens) e um botão "Confirmar e importar".
5. Se alguma venda tiver algo que o agente não sabe resolver (forma de
   pagamento não mapeada, produto que não bate por nome no catálogo): marca
   como `bloqueado` com a lista exata do que falta resolver — **nenhuma
   venda do lote é importada** até isso ser corrigido (cadastrar o produto
   faltante, por exemplo) e a busca ser refeita.

## Instalação

1. Copiar a pasta `gmax-agent/` pra esta máquina (SERVIDOR), se ainda não
   estiver aqui.
2. Confirmar que **Python 3** está instalado (`python --version`) — se não
   estiver, instalar de [python.org](https://python.org) primeiro (esta é
   uma dependência nova, o print-agent não precisava disso).
3. Rodar `powershell -File setup.ps1` — baixa o motor Firebird 2.5 embedded
   (64-bit) e instala o pacote Python `fdb`.
4. `cp .env.example .env` e preencher com os valores reais (mesmos do
   `.env.local`/`print-agent/.env` — `NEXT_PUBLIC_SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`, achados em Project Settings → API no painel
   do Supabase). Confirmar `CAMINHO_GMAX_FDB` (default
   `C:\GMax\GMaxERP.FDB`). **Nunca commitar o `.env`.**
5. Testar manualmente: `python agent.py` — deve logar "Agente de
   importação GMax rodando...".
6. Configurar pra rodar sozinho no login (mesmo padrão do print-agent):
   atalho na pasta Inicializar do Windows (`shell:startup`) apontando pro
   `iniciar_agente_oculto.vbs`.

## Limitações conhecidas

- **Depende de Python 3 instalado na máquina** — único requisito externo
  além do que o print-agent já precisa (a leitura Firebird embedded só tem
  driver maduro em Python neste projeto, ver `migracao-dados/`).
- **Forma de pagamento e produto resolvidos por uma regra fixa/nome exato**
  — uma condição de pagamento nova no GMax, ou um produto cadastrado com
  nome ligeiramente diferente, bloqueia o lote inteiro até um humano
  ajustar (ver `mapeamento_pagamento.py` pra estender o mapeamento).
- **Vendedor é resolvido por aproximação de nome** (`ilike`) e pode ficar
  em branco se não bater com nenhum perfil do Trolesi — não bloqueia a
  importação (afeta só atribuição de comissão, não o valor da venda).
- **Só considera pedidos GMax com status "recebido"/"faturado"**
  (`STATUS_PEDIDO.SIGLA` em R/RE/RF/PRP) — orçamentos e pedidos ainda em
  andamento no GMax ficam de fora até virarem venda de verdade, e são
  reconsiderados sozinhos numa busca futura.
- **Um pedido só entra uma vez** (`pedidos.gmax_pedido_id` é único) — rodar
  a busca de novo nunca duplica uma venda já importada.
- Só um agente deve rodar por vez, mesma regra do print-agent.
