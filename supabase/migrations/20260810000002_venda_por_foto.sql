-- Lançar venda por foto: fotografar a notinha manuscrita, IA sugere os
-- campos do pedido, vendedor revisa e confirma (mesmo espírito do Trolesi
-- Vision AI de cadastro de produto por foto, 20260725000001, mas pro fluxo
-- de venda). Guarda a foto original pra auditoria — 1 foto por pedido, por
-- isso é uma coluna simples em `pedidos`, não uma tabela à parte como
-- `produto_imagens` (que precisa de várias fotos por produto).
--
-- ROLLBACK:
-- alter table public.pedidos drop column if exists notinha_foto_path;
-- delete from storage.objects where bucket_id = 'pedidos-notas-fotos';
-- delete from storage.buckets where id = 'pedidos-notas-fotos';

alter table public.pedidos
  add column if not exists notinha_foto_path text;

insert into storage.buckets (id, name, public)
values ('pedidos-notas-fotos', 'pedidos-notas-fotos', false)
on conflict (id) do nothing;

-- Sem leitura pública (diferente de produtos-fotos) — é registro interno de
-- venda, não material de vitrine. Só quem pode lançar pedido (admin/vendedor,
-- mesmos papéis de `podeEditarPedidos`) sobe ou lê.
drop policy if exists "admin e vendedor leem fotos de notinha" on storage.objects;
create policy "admin e vendedor leem fotos de notinha"
  on storage.objects for select
  using (bucket_id = 'pedidos-notas-fotos' and public.meu_papel() in ('admin', 'vendedor'));

drop policy if exists "admin e vendedor sobem fotos de notinha" on storage.objects;
create policy "admin e vendedor sobem fotos de notinha"
  on storage.objects for insert
  with check (bucket_id = 'pedidos-notas-fotos' and public.meu_papel() in ('admin', 'vendedor'));
