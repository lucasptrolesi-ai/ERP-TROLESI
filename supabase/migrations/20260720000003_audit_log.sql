-- Fundação (Fase 1): auditoria central (seção 25 do documento mestre) —
-- toda exceção (desconto acima do limite, abatimento, garantia, crediário,
-- reabertura de caixa etc.) grava aqui: quem, quando, valor anterior, valor
-- novo, justificativa. Tabela genérica, reutilizável por qualquer módulo
-- futuro — não é um log por módulo.
--
-- ROLLBACK:
-- drop function if exists public.registrar_auditoria(text, uuid, text, jsonb, jsonb, text);
-- drop table if exists public.audit_log;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tabela text not null,
  registro_id uuid,
  acao text not null,
  usuario_id uuid references public.profiles (id),
  valor_anterior jsonb,
  valor_novo jsonb,
  justificativa text,
  criado_em timestamptz not null default now()
);

create index audit_log_tabela_registro_idx on public.audit_log (tabela, registro_id);

alter table public.audit_log enable row level security;

create policy "admin le audit_log"
  on public.audit_log for select
  using (public.meu_papel() = 'admin');

-- Sem policy de insert por design: só funções SECURITY DEFINER gravam aqui
-- (via registrar_auditoria), nunca um insert direto do cliente — senão a
-- trilha de auditoria podia ser forjada por quem tem acesso de escrita à
-- tabela de origem.
create or replace function public.registrar_auditoria(
  p_tabela text,
  p_registro_id uuid,
  p_acao text,
  p_valor_anterior jsonb default null,
  p_valor_novo jsonb default null,
  p_justificativa text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tabela, registro_id, acao, usuario_id, valor_anterior, valor_novo, justificativa)
  values (p_tabela, p_registro_id, p_acao, auth.uid(), p_valor_anterior, p_valor_novo, p_justificativa);
end;
$$;
