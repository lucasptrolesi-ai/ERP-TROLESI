export const STATUS_LABEL: Record<string, { rotulo: string; classe: string }> = {
  orcamento: { rotulo: "Orçamento", classe: "bg-warn-bg text-warn" },
  pedido: { rotulo: "Pedido", classe: "bg-line text-text-soft" },
  faturado: { rotulo: "Faturado", classe: "bg-ok-bg text-ok" },
  cancelado: { rotulo: "Cancelado", classe: "bg-crit-bg text-crit" },
  aguardando_lancamento_gmax: { rotulo: "Aguardando GMax", classe: "bg-warn-bg text-warn" },
  lancado_gmax: { rotulo: "Lançado no GMax", classe: "bg-ok-bg text-ok" },
};
