-- =====================================================================
--  034 – Logos des équipes adverses
--  - clubs_adverses : un club adverse, ses noms d'équipe et son logo.
--    Un même club peut avoir plusieurs équipes (CAL 1, CAL 3…) : elles
--    partagent le même logo. « alias » = les noms d'équipe simplifiés
--    (minuscules, sans accent ni apostrophe, sans le numéro final) :
--    « Patrick's 3 » → « patricks », « PDC 1 » → « pdc ».
--  - logo : soit un fichier du site (assets/img/adversaires/…), soit une
--    image envoyée depuis le formulaire de rencontre (dossier « logos/ »
--    du stockage public « public-images »).
--  Lecture publique. Ajout / changement de logo : capitaines et admins ;
--  suppression d'un club : admin seulement.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 033.
--  Peut être relancé sans créer de doublon.
-- =====================================================================

create table if not exists public.clubs_adverses (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(nom) between 1 and 80),
  alias       text[] not null default '{}',
  logo        text check (logo is null or (char_length(logo) <= 200 and logo ~ '^(assets/img/adversaires/|logos/)[A-Za-z0-9._/-]+$')),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create unique index if not exists clubs_adverses_nom on public.clubs_adverses (lower(nom));

drop trigger if exists clubs_adverses_maj on public.clubs_adverses;
create trigger clubs_adverses_maj before update on public.clubs_adverses
  for each row execute function public.rencontre_maj();

alter table public.clubs_adverses enable row level security;

drop policy if exists clubs_adverses_select on public.clubs_adverses;
create policy clubs_adverses_select on public.clubs_adverses for select to anon, authenticated using (true);
drop policy if exists clubs_adverses_insert on public.clubs_adverses;
create policy clubs_adverses_insert on public.clubs_adverses for insert to authenticated with check (public.est_capitaine_ou_admin());
drop policy if exists clubs_adverses_update on public.clubs_adverses;
create policy clubs_adverses_update on public.clubs_adverses for update to authenticated
  using (public.est_capitaine_ou_admin()) with check (public.est_capitaine_ou_admin());
drop policy if exists clubs_adverses_delete on public.clubs_adverses;
create policy clubs_adverses_delete on public.clubs_adverses for delete to authenticated using (public.is_admin());

-- Stockage : les capitaines peuvent aussi envoyer des logos (dossier logos/ uniquement).
-- Les admins le peuvent déjà (règles du script 006).
drop policy if exists "logos adverses : envoi capitaines" on storage.objects;
create policy "logos adverses : envoi capitaines" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'logos' and public.est_capitaine_ou_admin());
drop policy if exists "logos adverses : modification capitaines" on storage.objects;
create policy "logos adverses : modification capitaines" on storage.objects for update to authenticated
  using (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'logos' and public.est_capitaine_ou_admin())
  with check (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'logos' and public.est_capitaine_ou_admin());

-- Clubs de la saison 2026-2027 et leurs logos
insert into public.clubs_adverses (nom, alias, logo, created_by) values
  ('A.R.M.Y. 78', '{army 78,army}', 'assets/img/adversaires/army-78.webp', null),
  ('CAL Darts L''Haÿ-les-Roses', '{cal}', 'assets/img/adversaires/cal.webp', null),
  ('Darting Club', '{darting club,darting}', 'assets/img/adversaires/darting-club.webp', null),
  ('Darts Unesco Club', '{duc}', 'assets/img/adversaires/duc.webp', null),
  ('Évry-Courcouronnes Darts Club', '{ecdc}', 'assets/img/adversaires/ecdc.webp', null),
  ('HODC Hurling Pub', '{hodc}', 'assets/img/adversaires/hodc.webp', null),
  ('Lowtown Club', '{ltc,lowtown,lowtown club}', 'assets/img/adversaires/ltc.webp', null),
  ('Patricks Darts Corporation', '{pdc,patricks}', 'assets/img/adversaires/pdc.webp', null),
  ('Darts SMFE 91', '{smfe 91,smfe,smef 91}', 'assets/img/adversaires/smfe-91.webp', null),
  ('Sputnik', '{sputnik}', 'assets/img/adversaires/sputnik.webp', null),
  ('Team Darts 95', '{team darts}', 'assets/img/adversaires/team-darts-95.webp', null),
  ('Underground Darts Club Montmartre', '{ugdc}', 'assets/img/adversaires/ugdc.webp', null)
on conflict do nothing;
