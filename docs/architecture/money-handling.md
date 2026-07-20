# Decisão de dinheiro — ERP/PDV Trolesi

Decidido uma vez, em 2026-07-20 (Fase 1 da fundação), conforme seção 5 do documento mestre. Qualquer mudança futura exige migração de dados documentada, não uma alteração silenciosa.

## Representação

- **Banco (Postgres/Supabase): `numeric(10, 2)` em toda coluna monetária.** Nunca `float`/`double`/`real`. Já era o padrão em todas as tabelas existentes (`produtos.custo`, `pedidos.total`, `contas_receber.valor` etc.) — esta seção formaliza o que já estava em uso, não muda nada.
- **Backend (funções Postgres `SECURITY DEFINER`/`INVOKER`): todo total final é recalculado a partir dos itens, em SQL, usando `numeric`.** O valor computado no cliente (carrinho, simulador de parcelas) nunca é a fonte de verdade gravada — serve só de prévia. Exemplo já em produção: `criar_pedido()` recalcula `v_subtotal`/`v_total` a partir de `p_itens` (jsonb) em vez de aceitar um total pronto vindo do formulário.
- **Frontend (TypeScript/React): `number` (float64) é aceitável apenas para exibição e simulação, nunca para o valor final gravado.** Todo cálculo client-side existe só para o usuário ver uma prévia antes de salvar; o servidor sempre recalcula. Arredondamento de exibição usa `Math.round(valor * 100) / 100` (2 casas), consistente em todo o código.

## Por que não centavos-inteiros (`bigint`)

Avaliado e descartado por ora: o schema já é 100% `numeric(10,2)` desde a Fase 2 original, sem nenhum caso de erro de arredondamento relatado em produção até hoje. Migrar pra centavos-inteiros exigiria reescrever todas as colunas monetárias existentes (custo, preço, total, valor de parcela) sem ganho concreto, já que `numeric` no Postgres é decimal exato (não binário) — o risco que `bigint`-em-centavos resolve (erro de ponto flutuante) já não existe aqui. Reavaliar apenas se um bug real de arredondamento aparecer.

## Onde isso se aplica

Toda tabela/função que lida com dinheiro deve seguir esta decisão. Novas colunas monetárias: sempre `numeric(10, 2)`. Novas funções `SECURITY DEFINER` que gravam total/valor: sempre recalcular a partir dos componentes (itens, parcelas), nunca aceitar o total pronto do cliente sem checagem.

## Cálculos extraídos como funções puras testáveis

Por regra do documento mestre ("regra de negócio = código, nunca só texto"), todo cálculo comercial vira uma função nomeada e testada, não uma expressão solta dentro de um componente. Primeira extração (Fase 1): `src/lib/precificacao.ts` — `calcularPrecoUnitario(codigoPeca, multiplicador)`, testado em `src/lib/precificacao.test.ts`.
