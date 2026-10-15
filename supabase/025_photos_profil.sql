-- =====================================================================
--  Étape 7a : photo de profil
--  À exécuter une fois dans Supabase (après 024) : SQL Editor > New query > Run
--
--  Règles (cahier des charges : « photo visible des membres connectés ») :
--  - dossier « photos-profil » PRIVÉ : les visiteurs ne peuvent pas voir
--    les photos, même avec le lien ; le site demande pour chaque photo un
--    lien temporaire (1 heure), accordé seulement aux membres validés
--  - chaque membre envoie, remplace ou retire uniquement SA photo, rangée
--    dans un sous-dossier à son identifiant
--  - une photo n'est possible qu'avec l'accord « ma photo est visible des
--    membres connectés » ; retirer l'accord retire la photo
--  - un admin peut retirer la photo d'un membre (photo inappropriée)
--  - 2 Mo maximum, JPEG ou WebP (le site réduit déjà la photo à 400 × 400)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos-profil', 'photos-profil', false, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Voir : les membres validés, et chacun sa propre photo (même en attente de validation)
drop policy if exists "photos profil : lecture membres" on storage.objects;
create policy "photos profil : lecture membres" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos-profil'
         and (public.is_active_member() or (storage.foldername(name))[1] = auth.uid()::text));

-- Envoyer : seulement dans son propre dossier
drop policy if exists "photos profil : envoi par le membre" on storage.objects;
create policy "photos profil : envoi par le membre" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos-profil' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos profil : modification par le membre" on storage.objects;
create policy "photos profil : modification par le membre" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos-profil' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos-profil' and (storage.foldername(name))[1] = auth.uid()::text);

-- Supprimer : le membre (sa photo) ou un admin
drop policy if exists "photos profil : suppression" on storage.objects;
create policy "photos profil : suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos-profil'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Cohérence du profil : la photo est rangée dans le dossier du membre,
-- et n'existe qu'avec son accord
create or replace function public.verifier_photo_profil()
returns trigger language plpgsql set search_path = public as $$
begin
  if not coalesce(new.photo_consent, false) then
    new.photo_path := null;
  end if;
  if new.photo_path is not null
     and (new.photo_path not like new.id::text || '/%' or new.photo_path like '%..%' or length(new.photo_path) > 120) then
    raise exception 'Photo de profil invalide.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_verifier_photo on public.profiles;
create trigger profiles_verifier_photo before insert or update of photo_path, photo_consent on public.profiles
  for each row execute function public.verifier_photo_profil();

notify pgrst, 'reload schema';
