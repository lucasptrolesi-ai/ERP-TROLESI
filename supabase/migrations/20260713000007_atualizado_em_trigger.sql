-- Fase 2: mantém "atualizado_em" correto em UPDATE sem depender de cada
-- módulo lembrar de setar isso na aplicação.

create function public.set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger clientes_atualizado_em
  before update on public.clientes
  for each row execute function public.set_atualizado_em();

create trigger produtos_atualizado_em
  before update on public.produtos
  for each row execute function public.set_atualizado_em();

create trigger pedidos_atualizado_em
  before update on public.pedidos
  for each row execute function public.set_atualizado_em();

create trigger notas_fiscais_atualizado_em
  before update on public.notas_fiscais
  for each row execute function public.set_atualizado_em();
