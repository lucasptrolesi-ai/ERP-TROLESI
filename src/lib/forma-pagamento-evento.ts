import type { FormaPagamentoEvento } from "./types";

// Conjunto próprio do PDV Eventos (2026-08-13) — pedido direto do usuário:
// cartão sempre "à vista" ou "parcelado" (sem separar débito/crédito à
// vista), sem promissória, sem pagamento misto.
export const FORMA_LABEL_EVENTO: Record<FormaPagamentoEvento, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao_vista: "Cartão à vista",
  cartao_parcelado: "Cartão parcelado",
};

export const FORMAS_PAGAMENTO_EVENTO: FormaPagamentoEvento[] = ["dinheiro", "pix", "cartao_vista", "cartao_parcelado"];
