-- Fecha a corrida de duplo-clique/duas-abas: sem isso, dois cliques rápidos
-- em "Gerar XML" (ou duas abas abertas no mesmo pedido) podiam criar duas
-- notas_fiscais pro mesmo pedido antes do primeiro insert terminar — a
-- checagem em código (select antes do insert) sozinha não fecha essa janela.
alter table public.notas_fiscais
  add constraint notas_fiscais_pedido_id_key unique (pedido_id);
