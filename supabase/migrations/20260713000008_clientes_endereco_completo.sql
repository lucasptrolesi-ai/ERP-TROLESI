-- Fase 4: endereço completo (bairro, CEP), data de nascimento e e-mail no
-- cadastro de cliente. Só em clientes (pessoa física) — fornecedor
-- normalmente é empresa, não se aplica data de nascimento.

alter table public.clientes
  add column bairro text,
  add column cep text,
  add column data_nascimento date,
  add column email text;
