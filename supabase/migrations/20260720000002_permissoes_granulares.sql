-- Fundação (Fase 1): permissões granulares por ação (seção 25 do documento
-- mestre), ESTENDENDO os 4 papéis já existentes — não substitui a RLS por
-- papel que já protege cada tabela hoje. `admin` continua tendo acesso total
-- por definição (não precisa de linha em `permissoes_usuario`); as demais
-- permissões "sensíveis" (conceder desconto acima do limite, aprovar
-- abatimento, reabrir caixa etc.) exigem uma concessão explícita, auditável,
-- por usuário.
--
-- ROLLBACK:
-- drop function if exists public.tem_permissao(public.permissao_especial);
-- drop table if exists public.permissoes_usuario;
-- drop type if exists public.permissao_especial;

create type public.permissao_especial as enum (
  'alterar_preco_multiplicador',
  'informar_cotacao',
  'conceder_desconto_acima_limite',
  'liberar_primeira_compra_abaixo_minimo',
  'liberar_reativacao_abaixo_minimo',
  'aprovar_valor_abatimento',
  'aprovar_reprovar_garantia',
  'criar_excecao_crediario',
  'receber_crediario',
  'reabrir_caixa',
  'cancelar_venda',
  'estornar_pagamento',
  'alterar_estoque_manual',
  'conceder_frete_gratis',
  'acessar_codigo_interno',
  'consultar_custo_margem'
);

create table public.permissoes_usuario (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  permissao public.permissao_especial not null,
  concedida_por uuid references public.profiles (id),
  concedida_em timestamptz not null default now(),
  unique (profile_id, permissao)
);

alter table public.permissoes_usuario enable row level security;

create policy "admin gerencia permissoes_usuario"
  on public.permissoes_usuario for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

create policy "usuario le as proprias permissoes"
  on public.permissoes_usuario for select
  using (profile_id = auth.uid());

-- Helper reutilizável: admin sempre tem todas as permissões implicitamente;
-- os demais papéis precisam de concessão explícita nesta tabela. Funções
-- SECURITY DEFINER futuras (abatimento, garantia, crediário, caixa) chamam
-- isso em vez de reimplementar a checagem cada uma à sua maneira.
create or replace function public.tem_permissao(p_permissao public.permissao_especial)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.meu_papel() = 'admin' then
    return true;
  end if;

  return exists (
    select 1 from public.permissoes_usuario
    where profile_id = auth.uid() and permissao = p_permissao
  );
end;
$$;
