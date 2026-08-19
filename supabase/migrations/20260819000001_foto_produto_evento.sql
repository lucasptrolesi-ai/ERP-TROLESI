-- Foto do produto (pedido do usuário, 2026-08-19): produtos_evento (PDV
-- Eventos) não tinha foto nenhuma — produtos (Estoque real) já tem foto_url
-- desde sempre. Aproveita o mesmo bucket produtos-fotos (20260725000001) em
-- vez de criar um novo, só numa subpasta.
--
-- ROLLBACK:
-- alter table public.produtos_evento drop column if exists foto_url;
-- drop policy if exists "estoque, admin e vendedor sobem fotos de produto" on storage.objects;
-- drop policy if exists "estoque, admin e vendedor removem fotos de produto" on storage.objects;
-- create policy "estoque e admin sobem fotos de produto" on storage.objects for insert with check (bucket_id = 'produtos-fotos' and public.meu_papel() in ('admin', 'estoque'));
-- create policy "estoque e admin removem fotos de produto" on storage.objects for delete using (bucket_id = 'produtos-fotos' and public.meu_papel() in ('admin', 'estoque'));

alter table public.produtos_evento
  add column if not exists foto_url text;

-- As policies de storage.objects de produtos-fotos (20260725000001) só
-- liberavam admin/estoque pra subir/remover — cadastro do PDV Eventos é
-- admin/vendedor (podeEditarPedidos, ver /pdv-eventos/page.tsx), então
-- vendedor nunca teria conseguido subir a foto de uma peça de evento sem
-- isso. Substitui pelas mesmas duas policies incluindo vendedor.
drop policy if exists "estoque e admin sobem fotos de produto" on storage.objects;
create policy "estoque, admin e vendedor sobem fotos de produto"
  on storage.objects for insert
  with check (bucket_id = 'produtos-fotos' and public.meu_papel() in ('admin', 'estoque', 'vendedor'));

drop policy if exists "estoque e admin removem fotos de produto" on storage.objects;
create policy "estoque, admin e vendedor removem fotos de produto"
  on storage.objects for delete
  using (bucket_id = 'produtos-fotos' and public.meu_papel() in ('admin', 'estoque', 'vendedor'));
