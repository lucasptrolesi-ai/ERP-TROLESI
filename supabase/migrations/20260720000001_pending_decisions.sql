-- Fundação (Fase 1 do documento mestre): tabela de ambiguidades de negócio
-- que não podem ser decididas por suposição (seção 27). Cada linha nasce
-- com `ativo = false` — a funcionalidade correspondente fica desligada até
-- um humano autorizado tomar a decisão e ativar explicitamente.
--
-- ROLLBACK:
-- drop table if exists public.pending_decisions;

create table public.pending_decisions (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  descricao text not null,
  ativo boolean not null default false,
  decidido_em timestamptz,
  decidido_por uuid references public.profiles (id),
  decisao text,
  criado_em timestamptz not null default now()
);

alter table public.pending_decisions enable row level security;

create policy "admin gerencia pending_decisions"
  on public.pending_decisions for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

insert into public.pending_decisions (chave, descricao) values
  ('primeira_compra_prata925_combinacao', 'Como a prata 925 código ≥ 20,0 participa exatamente do mínimo da primeira compra.'),
  ('frete_gratis_base_calculo', 'Qual valor é a base do frete grátis de R$700 (bruto / pós-desconto / pós-abatimento / só elegíveis).'),
  ('desconto_pagamento_misto', 'Como desconto funciona em pagamento misto.'),
  ('codigo_ventilador_finalidade', 'Finalidade exata do código Ventilador — validar contra uso real no legado antes de implementar.'),
  ('comissao_crediario_calculo', 'Como a comissão do crediário legado é calculada.'),
  ('crediario_bloqueio_atraso', 'Se o bloqueio de crediário ocorre no 5º dia de atraso ou após completar 5 dias.'),
  ('garantia_descascamento_medicao', 'Como o percentual de 80% de descascamento (garantia de folheado) será medido/registrado.'),
  ('abatimento_destino_pecas', 'Destino contábil/físico final das peças recebidas em abatimento.'),
  ('multiplicador_ouro_cobre', 'Se ouro e cobre usam multiplicador adicional após a cotação do dia.'),
  ('abatimento_reduz_base_desconto_frete', 'Se o abatimento reduz a base usada para desconto e/ou frete grátis.')
on conflict (chave) do nothing;

-- Uma decisão já tomada fora do fluxo do app (na própria conversa com o
-- usuário, 2026-07-20): registrada aqui já decidida, não como pendência em
-- aberto — histórico de que o documento mestre foi fundido ao projeto
-- existente, não tratado como operação separada.
insert into public.pending_decisions (chave, descricao, ativo, decidido_em, decisao) values
  (
    'escopo_documento_mestre_operacao',
    'Se este documento mestre descreve a mesma Trolesi atacadista já em produção ou uma operação de varejo diferente.',
    true,
    now(),
    'Fusão confirmada pelo usuário em 2026-07-20: mesma Trolesi, mesmo repositório — o documento mestre vira o processo oficial permanente, estendendo o que já existe.'
  )
on conflict (chave) do nothing;
