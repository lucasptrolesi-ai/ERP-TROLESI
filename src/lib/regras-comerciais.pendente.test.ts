import { describe, it } from "vitest";

/**
 * Spec viva das regras da seção 28 do documento mestre que ainda não existem
 * no código (fases 3 e 4). Cada `it.todo` vira uma asserção real na fase que
 * implementar a regra — nenhuma fase é considerada concluída enquanto o teste
 * correspondente continuar como `todo` em vez de passar de verdade.
 *
 * Itens já cobertos com teste real: multiplicador 2,8 (ver precificacao.test.ts),
 * desconto automático por forma de pagamento (ver desconto.test.ts), limiares
 * de parcelamento sem juros (ver parcelamento.test.ts), abatimento de peças
 * (ver abatimento.test.ts), garantias (ver garantia.test.ts), comissão (ver
 * comissao.test.ts).
 *
 * Itens implementados em SQL (criar_pedido/converter_cliente_em_crediario)
 * mas sem teste automatizado ainda — exigiria infraestrutura de teste de
 * integração contra um banco Postgres real, fora do escopo desta fase.
 * Continuam listados aqui como pendência real, não escondidos.
 */

describe("Fase 3 — parcelamento por limiar de valor (UI)", () => {
  it.todo("interface nunca mostra opção de parcela que a regra não permite para aquela venda");
});

describe("Fase 3 — primeira compra e reativação (implementado em SQL, sem teste de integração)", () => {
  it.todo("primeira compra abaixo de R$1000 é bloqueada sem autorização");
  it.todo(
    "peças de prata 925 com código ≥ 20,0 são somadas separadamente do mínimo principal — pendency #1, aguarda decisão",
  );
  it.todo("cliente com 6 a 11 meses sem comprar exige mínimo de R$600");
  it.todo("cliente com 12+ meses sem comprar exige mínimo de R$800");
  it.todo("exceção de primeira compra/reativação exige usuário autorizado + justificativa + auditoria");
});

describe("Fase 3 — pagamento (idempotência/estoque implementados em SQL, sem teste de integração)", () => {
  it.todo("pagamento misto: soma dos valores informados bate exatamente com o total da venda");
  it.todo("desconto em pagamento misto — pendência #3, aguarda decisão antes de implementar qualquer divisão");
  it.todo("clique duplo em finalizar venda não cria duas vendas (idempotência no backend)");
  it.todo("duas vendas concorrentes do mesmo produto não conseguem vender o mesmo estoque duas vezes");
});

describe("Fase 4 — abatimento de peças (regra de negócio testada; falta UI e vínculo com venda real)", () => {
  it.todo("abatimento nunca é lançado como desconto manual — é um lançamento contábil separado (falta UI)");
});

describe("Fase 4 — garantias (regra de negócio testada; falta UI e fluxo Orient completo)", () => {
  it.todo("garantia de relógio Orient deixa explícito que a decisão técnica é da fabricante, não da loja (falta UI)");
});

describe("Fase 4 — crediário legado (implementado em SQL, sem teste de integração)", () => {
  it.todo("nenhum usuário comum consegue converter cliente novo em crediário — só admin autorizado");
  it.todo("bloqueio de crediário por atraso > 5 dias — pendência #6 (5º dia vs. após completar 5 dias), aguarda decisão");
  it.todo("recebimento de crediário em dinheiro exige caixa aberto + operador + recibo, sem duplicidade");
});

describe("Fase 4 — frete e expedição", () => {
  it.todo(
    "frete grátis acima de R$700 — pendência #2 (base: bruto/pós-desconto/pós-abatimento/só elegíveis), aguarda decisão",
  );
});

describe("Fundação — permissões e auditoria", () => {
  it.todo("usuário sem permissão explícita não consegue conceder desconto acima do limite configurado");
  it.todo("toda exceção (desconto, primeira compra, abatimento, crediário) grava usuário, justificativa, valor anterior e novo no audit_log");
});

describe("Código Ventilador (condicional — só ativa após validação contra uso real no legado)", () => {
  it.todo(
    "código Ventilador nunca aparece em comprovante ou tela visível ao cliente, mesmo quando ativado por permissão",
  );
});
