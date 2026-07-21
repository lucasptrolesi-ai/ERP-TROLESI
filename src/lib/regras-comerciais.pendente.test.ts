import { describe, it } from "vitest";

/**
 * Spec viva das regras da seção 28 do documento mestre que ainda não existem
 * no código (fases 3 e 4). Cada `it.todo` vira uma asserção real na fase que
 * implementar a regra — nenhuma fase é considerada concluída enquanto o teste
 * correspondente continuar como `todo` em vez de passar de verdade.
 *
 * Itens já cobertos com teste real: multiplicador 2,8 e preço por cotação
 * diária (ver precificacao.test.ts), desconto automático por forma de
 * pagamento (ver desconto.test.ts), limiares de parcelamento sem juros (ver
 * parcelamento.test.ts), abatimento de peças (ver abatimento.test.ts),
 * garantias (ver garantia.test.ts), comissão (ver comissao.test.ts), bloqueio
 * de crediário por atraso (ver situacao-conta.test.ts).
 *
 * As 10 ambiguidades da seção 27 foram decididas em 2026-07-21 (ver
 * pending_decisions no banco e DECISIONS.md) — os itens abaixo que citavam
 * "aguarda decisão" seguem como pendência só de teste de integração, não de
 * regra em aberto.
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
    "peças de prata 925 com código ≥ 20,0 contam no total do mínimo e aparecem destacadas no carrinho (decidido — implementado em novo-pedido.tsx, falta teste de integração)",
  );
  it.todo("cliente com 6 a 11 meses sem comprar exige mínimo de R$600");
  it.todo("cliente com 12+ meses sem comprar exige mínimo de R$800");
  it.todo("exceção de primeira compra/reativação exige usuário autorizado + justificativa + auditoria");
});

describe("Fase 3 — pagamento (idempotência/estoque implementados em SQL, sem teste de integração)", () => {
  it.todo("pagamento misto: soma dos valores informados bate exatamente com o total da venda (implementado em criar_pedido v7)");
  it.todo("pagamento misto nunca recebe desconto automático (decidido e implementado — falta teste de integração)");
  it.todo("clique duplo em finalizar venda não cria duas vendas (idempotência no backend)");
  it.todo("duas vendas concorrentes do mesmo produto não conseguem vender o mesmo estoque duas vezes");
});

describe("Fase 4 — abatimento de peças (regra de negócio testada; falta teste de integração)", () => {
  it.todo("abatimento nunca é lançado como desconto manual — é um lançamento contábil separado");
  it.todo("peça aprovada é destinada ao local 'Abatimentos recebidos' (decidido e implementado em aprovar_abatimento)");
});

describe("Fase 4 — garantias (regra de negócio testada; falta UI e fluxo Orient completo)", () => {
  it.todo("garantia de relógio Orient deixa explícito que a decisão técnica é da fabricante, não da loja (falta UI)");
});

describe("Fase 4 — crediário legado (implementado em SQL, sem teste de integração)", () => {
  it.todo("nenhum usuário comum consegue converter cliente novo em crediário — só admin autorizado");
  it.todo("lancar_crediario bloqueia novo lançamento quando cliente já tem atraso > 5 dias (regra pura testada em situacao-conta.test.ts; falta teste de integração do bloqueio em SQL)");
  it.todo("recebimento de crediário em dinheiro exige caixa aberto + operador + recibo, sem duplicidade");
  it.todo("comissão automática no recebimento de crediário usa o vendedor do pedido de origem (implementado em receber_crediario)");
});

describe("Fase 4 — frete e expedição", () => {
  it.todo(
    "frete grátis automático acima de R$700 (base = total do pedido, decidido) — implementado em criar_expedicao, falta teste de integração",
  );
});

describe("Fundação — permissões e auditoria", () => {
  it.todo("usuário sem permissão explícita não consegue conceder desconto acima do limite configurado");
  it.todo("toda exceção (desconto, primeira compra, abatimento, crediário) grava usuário, justificativa, valor anterior e novo no audit_log");
});

describe("Código Ventilador (investigado em 2026-07-21: sem evidência de uso real nos 44 produtos migrados do GMax — feature permanece não implementada)", () => {
  it.todo(
    "se uma evidência real de uso aparecer no futuro: código Ventilador nunca aparece em comprovante ou tela visível ao cliente, mesmo quando ativado por permissão",
  );
});
