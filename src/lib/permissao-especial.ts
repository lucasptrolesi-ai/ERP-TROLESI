import type { PermissaoEspecial } from "@/lib/types";

export const PERMISSAO_LABEL: Record<PermissaoEspecial, string> = {
  alterar_preco_multiplicador: "Alterar preço/multiplicador de produto",
  informar_cotacao: "Informar cotação diária (peças com cotação)",
  conceder_desconto_acima_limite: "Conceder desconto acima do limite automático",
  liberar_primeira_compra_abaixo_minimo: "Liberar primeira compra abaixo do mínimo",
  liberar_reativacao_abaixo_minimo: "Liberar reativação de cliente abaixo do mínimo",
  aprovar_valor_abatimento: "Aprovar/reprovar valor de abatimento",
  aprovar_reprovar_garantia: "Aprovar/reprovar garantia",
  criar_excecao_crediario: "Criar exceção de crediário legado",
  receber_crediario: "Receber pagamento de crediário legado",
  reabrir_caixa: "Reabrir caixa fechado",
  cancelar_venda: "Cancelar/extornar venda",
  estornar_pagamento: "Estornar pagamento recebido",
  alterar_estoque_manual: "Ajustar estoque manualmente",
  conceder_frete_gratis: "Conceder frete grátis",
  acessar_codigo_interno: "Acessar código interno de produto",
  consultar_custo_margem: "Consultar custo/margem de produto",
};

export const PERMISSOES_ORDENADAS = Object.keys(PERMISSAO_LABEL) as PermissaoEspecial[];
