-- Fase 5: cotação diária de ouro/cobre (seção 6 + decisão registrada em
-- pending_decisions para 'multiplicador_ouro_cobre') — produtos com
-- usa_cotacao_diaria=true (Fase 2) usavam um campo que nunca tinha
-- consumidor nenhum: nem UI pra lançar a cotação, nem cálculo de preço a
-- usando. Fecha essa lacuna com o mínimo necessário: tabela + function de
-- lançamento (permissão 'informar_cotacao', existente desde a Fase 1 e até
-- agora sem uso real) + cálculo puro em precificacao.ts.
--
-- ROLLBACK:
-- drop function if exists public.informar_cotacao(text, numeric);
-- drop table if exists public.cotacoes_diarias;

create table public.cotacoes_diarias (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  valor numeric(10, 2) not null check (valor > 0),
  data date not null,
  informado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  unique (material, data)
);

alter table public.cotacoes_diarias enable row level security;

create policy "time logado lê cotacoes_diarias"
  on public.cotacoes_diarias for select
  using (public.meu_papel() is not null);

-- Upsert do dia: quem tem a permissão granular 'informar_cotacao' pode
-- lançar/corrigir a cotação de hoje pra um material (ex: "Ouro", "Cobre").
-- Só um valor por material/dia — corrigir um lançamento errado é chamar de
-- novo com o valor certo, não editar direto a tabela.
--
-- `p_data` é OBRIGATÓRIO (sem default em current_date de propósito): "hoje"
-- pro negócio é hora de Brasília, e current_date no Postgres reflete o fuso
-- do servidor (normalmente UTC) — mesma classe de bug de fuso já corrigida
-- várias vezes neste projeto (ver src/lib/datas.ts). O cliente sempre manda
-- `hojeIso()` explicitamente, nunca confia no default do banco.
create or replace function public.informar_cotacao(p_material text, p_valor numeric, p_data date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.tem_permissao('informar_cotacao') then
    raise exception 'Sem permissão para informar cotação.';
  end if;
  if p_valor <= 0 then
    raise exception 'Cotação precisa ser maior que zero.';
  end if;

  insert into public.cotacoes_diarias (material, valor, data, informado_por)
  values (p_material, p_valor, p_data, auth.uid())
  on conflict (material, data) do update
    set valor = excluded.valor, informado_por = excluded.informado_por
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.informar_cotacao(text, numeric, date) from public;
grant execute on function public.informar_cotacao(text, numeric, date) to authenticated;

-- `tem_permissao` nunca tinha grant/revoke explícito (achado da checagem de
-- segurança da Fase 5 — ficava com o default do Postgres, executável por
-- qualquer role). Agora passa a ter um chamador legítimo direto via RPC (a
-- tela de Estoque usa pra decidir se mostra o campo de cotação editável) —
-- trava no mesmo padrão do resto do projeto em vez de deixar no default.
revoke all on function public.tem_permissao(public.permissao_especial) from public;
grant execute on function public.tem_permissao(public.permissao_especial) to authenticated;
