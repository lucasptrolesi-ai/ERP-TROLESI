-- Trolesi Vision AI foi implementado numa sessão que não tinha visibilidade
-- do trabalho do "documento mestre" (migration 20260720000004 em diante),
-- que já tinha dado a `produtos` um conjunto bem mais rico de atributos
-- comerciais. A migration 20260725000001_produtos_vision_ai.sql (aplicada
-- direto no banco, sem passar por este repositório) criou colunas paralelas
-- e redundantes às que já existiam. Esta migration desfaz especificamente
-- essas colunas equivocadas — nada do que o documento mestre criou é tocado.
--
-- Importante: `codigo_barras` **já existia** antes do Vision AI (criada pela
-- migration 20260720000004, campo manual pro código real do
-- fornecedor/embalagem, editável em `produto-form.tsx`) — meu
-- `add column if not exists codigo_barras` original foi um no-op nela, não
-- criou nada, então a coluna e qualquer dado real nela **não são tocados
-- aqui**. O único resquício meu ali é um índice único que impus sem
-- necessidade (documento mestre nunca desenhou esse campo como único) —
-- só esse índice é removido.
--
-- Mapeamento corrigido (Vision AI passa a escrever nas colunas que já
-- existem, em vez de duplicar):
--   banho              -> tipo_banho (já existe)
--   tamanho_aproximado -> tamanho (já existe)
--   pedra (texto livre) -> tem_pedra (boolean, já existe; a IA também
--                          passa a sugerir tem_perola)
--   etiqueta impressa   -> passa a codificar o próprio `codigo_interno`
--                          (já existe, já é a busca rápida tipo PDV) como
--                          código de barras, em vez de gerar um valor
--                          aleatório pra colocar em `codigo_barras`.
--   estilo/formato/acabamento/marca -> removidos (sem coluna correspondente
--                          e sem uso real fora da tela de revisão do Vision
--                          AI; a IA ainda pode mencionar isso em `descricao`)
--
-- `descricao`/`material`/`cor`/`colecao` também já existiam antes do Vision
-- AI (mesma migration 20260720000004) — meus `add column if not exists`
-- foram no-op neles também, ficam como estão, sem mudança nenhuma aqui.
-- `tags` (text[]) é mantida — não colide com nada do documento mestre e
-- segue útil pra antiduplicação por metadados.

drop index if exists public.produtos_codigo_barras_key;

alter table public.produtos
  drop column if exists banho,
  drop column if exists acabamento,
  drop column if exists pedra,
  drop column if exists estilo,
  drop column if exists formato,
  drop column if exists tamanho_aproximado,
  drop column if exists marca;
