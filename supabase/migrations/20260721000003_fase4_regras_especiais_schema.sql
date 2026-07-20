-- Fase 4 (documento mestre, "Regras especiais"): schema de abatimento,
-- garantias, crediário legado, comissões e frete/expedição. Só estrutura —
-- a UI dedicada de cada fluxo é trabalho incremental separado; o objetivo
-- aqui é a arquitetura já deixar espaço (seção 1) sem inventar regra que
-- não esteja no documento.
--
-- ROLLBACK:
-- drop table if exists public.expedicoes;
-- drop type if exists public.status_expedicao;
-- drop table if exists public.comissoes_lancamentos;
-- drop table if exists public.crediario_lancamentos;
-- alter table public.clientes
--   drop column if exists crediario_legado,
--   drop column if exists crediario_autorizado_em,
--   drop column if exists crediario_autorizado_por,
--   drop column if exists crediario_limite,
--   drop column if exists crediario_status;
-- drop table if exists public.garantias;
-- drop table if exists public.abatimentos;
-- drop type if exists public.abatimento_status;

-- ===== Abatimento de peças (seção 11) =====
create type public.abatimento_status as enum ('avaliando', 'aprovado', 'reprovado', 'vinculado');

create table public.abatimentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos (id) on delete set null,
  cliente_id uuid not null references public.clientes (id),
  material text,
  tipo_peca text,
  marca_presente boolean not null default false,
  danificada boolean not null default false,
  tem_pedra boolean not null default false,
  tem_perola boolean not null default false,
  eh_fita_ou_fio boolean not null default false,
  ultima_colecao boolean not null default false,
  eh_relogio boolean not null default false,
  estado_descricao text,
  motivo_avaliacao text,
  valor_atribuido numeric(10, 2),
  status public.abatimento_status not null default 'avaliando',
  avaliado_por uuid references public.profiles (id),
  autorizado_por uuid references public.profiles (id),
  fotos jsonb,
  local_id uuid references public.locais_estoque (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.abatimentos enable row level security;

create policy "admin e vendedor gerenciam abatimentos"
  on public.abatimentos for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));

create trigger abatimentos_atualizado_em
  before update on public.abatimentos
  for each row execute function public.set_atualizado_em();

-- ===== Garantias (seções 12, 13, 14) =====
-- Reusa o enum garantia_produto_tipo já criado na Fase 2
-- (sem_garantia/folheado_ouro/autenticidade_prata_aco/orient).
create table public.garantias (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos (id) on delete set null,
  produto_id uuid references public.produtos (id),
  cliente_id uuid not null references public.clientes (id),
  tipo public.garantia_produto_tipo not null,
  -- Folheado a ouro
  percentual_descascamento numeric(5, 2),
  marca_presente boolean,
  peca_completa boolean,
  partes_faltando text,
  limpeza_realizada boolean,
  sinais_mau_uso boolean,
  alianca boolean not null default false,
  -- Comum
  fotos jsonb,
  parecer text,
  aprovado boolean,
  justificativa text,
  atendente_id uuid references public.profiles (id),
  aprovador_id uuid references public.profiles (id),
  -- Relógio Orient
  numero_serie text,
  protocolo_fabricante text,
  status_orient text,
  custo_reparo numeric(10, 2),
  cliente_aprovou_reparo boolean,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.garantias enable row level security;

create policy "admin e vendedor gerenciam garantias"
  on public.garantias for all
  using (public.meu_papel() in ('admin', 'vendedor'))
  with check (public.meu_papel() in ('admin', 'vendedor'));

create trigger garantias_atualizado_em
  before update on public.garantias
  for each row execute function public.set_atualizado_em();

-- ===== Crediário legado (seção 15) =====
alter table public.clientes
  add column crediario_legado boolean not null default false,
  add column crediario_autorizado_em timestamptz,
  add column crediario_autorizado_por uuid references public.profiles (id),
  add column crediario_limite numeric(10, 2),
  add column crediario_status text not null default 'ativo';

create table public.crediario_lancamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  pedido_id uuid references public.pedidos (id),
  valor numeric(10, 2) not null,
  vencimento date not null,
  situacao text not null default 'em_dia',
  pago_em timestamptz,
  recebido_por uuid references public.profiles (id),
  recibo_numero text,
  criado_em timestamptz not null default now()
);

alter table public.crediario_lancamentos enable row level security;

create policy "admin gerencia crediario_lancamentos"
  on public.crediario_lancamentos for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

-- Só admin autorizado converte cliente novo em crediário — nenhum usuário
-- comum pode fazer essa conversão (seção 15), com justificativa obrigatória
-- e registro em audit_log.
create or replace function public.converter_cliente_em_crediario(
  p_cliente_id uuid,
  p_limite numeric,
  p_justificativa text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_papel(array['admin']::public.papel_usuario[]);

  if p_justificativa is null or length(trim(p_justificativa)) = 0 then
    raise exception 'Justificativa é obrigatória pra converter cliente em crediário legado.';
  end if;

  update public.clientes
    set crediario_legado = true,
        crediario_autorizado_em = now(),
        crediario_autorizado_por = auth.uid(),
        crediario_limite = p_limite,
        crediario_status = 'ativo'
    where id = p_cliente_id;

  perform public.registrar_auditoria('clientes', p_cliente_id, 'converter_crediario_legado', null, jsonb_build_object('limite', p_limite), p_justificativa);
end;
$$;

revoke all on function public.converter_cliente_em_crediario(uuid, numeric, text) from public;
grant execute on function public.converter_cliente_em_crediario(uuid, numeric, text) to authenticated;

-- ===== Comissões (seção 21) =====
create table public.comissoes_lancamentos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id),
  pedido_id uuid references public.pedidos (id),
  evento public.evento_comissao not null,
  valor_base numeric(10, 2) not null,
  valor_comissao numeric(10, 2) not null,
  estornado boolean not null default false,
  criado_em timestamptz not null default now()
);

alter table public.comissoes_lancamentos enable row level security;

create policy "admin le e gerencia comissoes_lancamentos"
  on public.comissoes_lancamentos for all
  using (public.meu_papel() = 'admin')
  with check (public.meu_papel() = 'admin');

create policy "vendedor le as proprias comissoes"
  on public.comissoes_lancamentos for select
  using (
    exists (
      select 1 from public.vendedores v
      where v.id = comissoes_lancamentos.vendedor_id and v.profile_id = auth.uid()
    )
  );

-- ===== Frete / expedição (seção 22) =====
create type public.status_expedicao as enum (
  'aguardando_separacao', 'em_separacao', 'pronto_para_envio',
  'postado', 'em_transporte', 'entregue', 'devolvido', 'problema_transporte'
);

create table public.expedicoes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references public.pedidos (id) on delete cascade,
  endereco_entrega text,
  destinatario text,
  transportadora text,
  modalidade text,
  peso numeric(10, 3),
  volumes integer not null default 1,
  rastreamento text,
  custo numeric(10, 2) not null default 0,
  frete_gratis boolean not null default false,
  motivo_frete_gratis text,
  status public.status_expedicao not null default 'aguardando_separacao',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.expedicoes enable row level security;

create policy "admin e vendedor gerenciam expedicoes"
  on public.expedicoes for all
  using (public.meu_papel() in ('admin', 'vendedor', 'estoque'))
  with check (public.meu_papel() in ('admin', 'vendedor', 'estoque'));

create trigger expedicoes_atualizado_em
  before update on public.expedicoes
  for each row execute function public.set_atualizado_em();
