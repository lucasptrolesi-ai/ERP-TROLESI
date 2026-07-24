# -*- coding: utf-8 -*-
# Mapeamento CONDICOES_PAGAMENTO.ID (GMax) -> forma_pagamento (Trolesi).
# Levantado em 2026-07-24 consultando TODAS as condições cadastradas no GMax
# e quantas vezes cada uma foi realmente usada em pedidos históricos — cobre
# 100% do histórico real (215 de 215 pedidos com condição real).
#
# Decisões que não são "óbvias" e por isso registradas aqui:
# - CREDIARIO (4): mesma decisão tomada com o usuário em 2026-07-23 pro
#   pedido da Marcia de Fátima de Oliveira — registra como promissória
#   histórica, sem ativar o módulo de crediário legado automaticamente.
# - BOLETO/DUPLICATA (5): mais perto de "promissória" (papel com parcela)
#   do que de qualquer outra forma existente no Trolesi.
# - CARTAO 1 X (6) e CARTAO 2 X (7): nunca foram usadas de verdade (0
#   ocorrências no histórico), mas são obviamente cartão de crédito — não
#   faz sentido bloquear o lote inteiro se aparecerem só por causa disso.
# - LIVRE (0), DEVOLUCAO (-1), CREDITO DA CASA (-2): de propósito SEM
#   mapeamento — não são formas de pagamento de uma venda de verdade
#   (devolução é estorno, crédito da casa não é uma venda cobrada). Se
#   aparecerem, o lote inteiro fica bloqueado até um humano decidir — não
#   adivinha.
#
# Se uma condição nova aparecer no GMax e não estiver aqui, o pedido que a
# usa entra na lista de bloqueios do relatório (ver agent.py) em vez de
# adivinhar uma forma de pagamento.
MAPA_FORMA_PAGAMENTO = {
    1: "dinheiro",
    2: "cartao_credito",
    3: "debito",
    4: "promissoria",
    5: "promissoria",
    6: "cartao_credito",
    7: "cartao_credito",
    8: "pix",
}

# STATUS_PEDIDO.SIGLA que significam venda de verdade já recebida/faturada
# (a família "recebido") — orçamento, em produção, em standby, aguardando
# financeiro, em expedição e pronto-aguardando-recebimento ficam de fora
# por enquanto (venda ainda não fechada) e voltam a ser considerados
# automaticamente numa busca futura, assim que o status virar um destes.
STATUS_IMPORTAVEIS = ("R", "RE", "RF", "PRP")
