-- Fase 4: código interno da peça — identificador curto pra busca rápida
-- (tipo no PDV: digita o código, acha o produto na hora), diferente do
-- "codigo_peca" que é o valor usado no cálculo do preço. Único quando
-- preenchido (mesmo padrão do cpf_cnpj em clientes), mas não obrigatório —
-- nem todo produto precisa ter um definido desde já.

alter table public.produtos add column codigo_interno text;

create unique index produtos_codigo_interno_key
  on public.produtos (codigo_interno)
  where codigo_interno is not null;
