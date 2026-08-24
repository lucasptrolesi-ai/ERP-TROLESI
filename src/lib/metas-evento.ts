// Painel de Metas — Agroshow Itajubá 2026 (03 a 06/09), stand A-30.
// Painel é só leitura: nunca altera venda/estoque/financeiro, é cálculo em
// cima do que já existe (ver PROJECT_STATUS.md/DECISIONS.md pro desenho
// completo). Decisões #2 e #3 da spec original do usuário (custo por peça
// inclui frete/embalagem? deslocamento/hospedagem já estão dentro de
// CUSTO_EVENTO?) seguem em aberto — os números abaixo assumem que sim/não
// respectivamente da forma mais simples, então a margem real pode ser
// menor que 83,333% se a resposta acabar sendo diferente. Decisão #4
// (painel visível só pro admin ou pra qualquer usuário do PDV Eventos)
// também segue aberta — só importa a partir da Fase 3 (UI).

export const CUSTO_EVENTO = 16000; // decisão #1 da spec: adotado 16k (entre as opções 15k/16k/17k)
export const LUCRO_ALVO = 30000;
export const META_TRABALHO = 58000; // meta de trabalho — com folga sobre a meta bruta ideal (55.200)
export const TICKET_ALVO = 170;
export const NUM_PESSOAS_STAND = 2; // Lucas e Bianca, sem comissão

// CUSTO_PECA = PRECO_VENDA / 6, decomposto assim: CODIGO = PRECO_VENDA/8.4,
// PRECO_ATACADO = CODIGO*2.8 (= PRECO_VENDA/3), CUSTO_PECA = PRECO_ATACADO/2.
// Fração exata (5/6) em vez do decimal arredondado 0.83333 da spec — evita
// erro de centavo acumulado nas contas derivadas abaixo (55.200/19.200
// batem exatos com a fração, não com o decimal truncado).
export const MARGEM_BRUTA = 5 / 6;

export const MARGEM_NECESSARIA = CUSTO_EVENTO + LUCRO_ALVO; // 46.000
export const META_BRUTA_IDEAL = MARGEM_NECESSARIA / MARGEM_BRUTA; // 55.200
export const PONTO_EQUILIBRIO = CUSTO_EVENTO / MARGEM_BRUTA; // 19.200 — atingido sexta à noite (ver DIAS_EVENTO)

export const PERIODO_EVENTO = { inicio: "2026-09-03", fim: "2026-09-06" };

export type DiaEvento = {
  dia: string;
  data: string; // YYYY-MM-DD
  peso: number; // fração de META_TRABALHO (0.15 = 15%) — todos os pesos juntos somam 1
};

// Pesos configuráveis aqui (decisão #5 da spec: só no código por ora,
// sem UI de edição nesta entrega — nenhuma fase das 5 pediu isso).
export const DIAS_EVENTO: DiaEvento[] = [
  { dia: "Quinta", data: "2026-09-03", peso: 0.15 },
  { dia: "Sexta", data: "2026-09-04", peso: 0.2 },
  { dia: "Sábado", data: "2026-09-05", peso: 0.35 },
  { dia: "Domingo", data: "2026-09-06", peso: 0.3 },
];
