-- =====================================================================
-- Bucket público para as fotos do diário
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('day-photos', 'day-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "day photos read" on storage.objects;
create policy "day photos read" on storage.objects
  for select using (bucket_id = 'day-photos');

drop policy if exists "day photos insert" on storage.objects;
create policy "day photos insert" on storage.objects
  for insert with check (bucket_id = 'day-photos');

drop policy if exists "day photos delete" on storage.objects;
create policy "day photos delete" on storage.objects
  for delete using (bucket_id = 'day-photos');
