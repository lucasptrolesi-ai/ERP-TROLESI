-- Fase 5 (pós-entrega): `profiles` não guardava e-mail (só existe em
-- auth.users, que PostgREST não expõe pra query normal) — a tela de
-- Funcionários não tinha como mostrar/editar sabendo qual e-mail é de quem
-- sem isso. Denormaliza o e-mail em profiles (padrão comum em projetos
-- Supabase), populado pelo trigger de criação e mantido em sync.
--
-- ROLLBACK:
-- alter table public.profiles drop column email;
-- (reverter handle_novo_usuario pra versão anterior, sem gravar email)

alter table public.profiles add column email text;

update public.profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function public.handle_novo_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, papel, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', new.email), 'vendedor', new.email);
  return new;
end;
$$;
