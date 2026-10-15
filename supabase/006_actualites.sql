-- =====================================================================
--  Étape 4 — Actualités (à coller dans Supabase › SQL Editor, puis « Run »)
--
--  Crée l'espace de stockage des images d'actualités :
--  - lecture publique (les images s'affichent pour tous les visiteurs)
--  - envoi, remplacement et suppression réservés aux admins
--  - 5 Mo maximum par image, formats JPEG, PNG ou WebP
--  (le site réduit déjà chaque photo avant l'envoi)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-images', 'public-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "images publiques : envoi par les admins" on storage.objects;
create policy "images publiques : envoi par les admins" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'public-images' and public.is_admin());

drop policy if exists "images publiques : modification par les admins" on storage.objects;
create policy "images publiques : modification par les admins" on storage.objects
  for update to authenticated
  using (bucket_id = 'public-images' and public.is_admin())
  with check (bucket_id = 'public-images' and public.is_admin());

drop policy if exists "images publiques : suppression par les admins" on storage.objects;
create policy "images publiques : suppression par les admins" on storage.objects
  for delete to authenticated
  using (bucket_id = 'public-images' and public.is_admin());

-- Un article publié a toujours une date de publication
create or replace function public.article_published_at()
returns trigger language plpgsql as $$
begin
  if new.published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists articles_published_at on public.articles;
create trigger articles_published_at before insert or update on public.articles
  for each row execute function public.article_published_at();

-- Fin du script.
