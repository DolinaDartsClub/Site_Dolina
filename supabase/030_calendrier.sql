-- =====================================================================
--  030 – Calendrier des équipes (cahier des charges § 6.5)
--  - salles : carnet d'adresses commun (salle du club, salles adverses)
--  - rencontres : matchs de championnat de chaque équipe, avec le score
--    final (ex. 12 à 8) ; victoire / nul / défaite se déduisent du score
--  Lecture publique (visiteurs compris). Saisie : le capitaine de l'équipe
--  ou un admin. Carnet de salles : capitaines et admins ; suppression par
--  un admin seulement.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 029.
-- =====================================================================

create table if not exists public.salles (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(nom) between 1 and 80),
  adresse     text not null check (char_length(adresse) between 1 and 200),
  lien_carte  text check (lien_carte is null or (char_length(lien_carte) <= 300 and lien_carte ~ '^https://')),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index if not exists salles_nom on public.salles (lower(nom));

create table if not exists public.rencontres (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  date_match   date not null,
  heure_match  time,
  heure_rdv    time,
  salle_id     uuid references public.salles (id) on delete set null,
  domicile     boolean not null default true,
  adversaire   text not null check (char_length(adversaire) between 1 and 80),
  division     text check (char_length(division) <= 40),
  poule        text check (char_length(poule) <= 40),
  journee      text check (char_length(journee) <= 20),
  note         text check (char_length(note) <= 500),
  score_nous   smallint check (score_nous between 0 and 99),
  score_eux    smallint check (score_eux between 0 and 99),
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- Le score se saisit en entier ou pas du tout
  constraint rencontres_score_complet check ((score_nous is null) = (score_eux is null))
);
create index if not exists rencontres_equipe_date on public.rencontres (team_id, date_match);
create index if not exists rencontres_date on public.rencontres (date_match desc);

create or replace function public.rencontre_maj()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists rencontres_maj on public.rencontres;
create trigger rencontres_maj before update on public.rencontres
  for each row execute function public.rencontre_maj();

-- Capitaine (de n'importe quelle équipe) ou admin
create or replace function public.est_capitaine_ou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.teams t join public.profiles p on p.id = t.captain_id
    where t.captain_id = auth.uid() and p.status = 'active'
  );
$$;
grant execute on function public.est_capitaine_ou_admin() to anon, authenticated;

alter table public.salles enable row level security;
alter table public.rencontres enable row level security;

drop policy if exists salles_select on public.salles;
create policy salles_select on public.salles for select to anon, authenticated using (true);
drop policy if exists salles_insert on public.salles;
create policy salles_insert on public.salles for insert to authenticated with check (public.est_capitaine_ou_admin());
drop policy if exists salles_update on public.salles;
create policy salles_update on public.salles for update to authenticated
  using (public.est_capitaine_ou_admin()) with check (public.est_capitaine_ou_admin());
drop policy if exists salles_delete on public.salles;
create policy salles_delete on public.salles for delete to authenticated using (public.is_admin());

drop policy if exists rencontres_select on public.rencontres;
create policy rencontres_select on public.rencontres for select to anon, authenticated using (true);
drop policy if exists rencontres_insert on public.rencontres;
create policy rencontres_insert on public.rencontres for insert to authenticated
  with check (public.is_admin() or public.is_captain_of(team_id));
drop policy if exists rencontres_update on public.rencontres;
create policy rencontres_update on public.rencontres for update to authenticated
  using (public.is_admin() or public.is_captain_of(team_id))
  with check (public.is_admin() or public.is_captain_of(team_id));
drop policy if exists rencontres_delete on public.rencontres;
create policy rencontres_delete on public.rencontres for delete to authenticated
  using (public.is_admin() or public.is_captain_of(team_id));

-- Salle du club, déjà dans le carnet
insert into public.salles (nom, adresse, lien_carte, created_by)
values ('Gymnase Paul Souriau (Dolina)', '30 rue de Seine, 92100 Boulogne-Billancourt', 'https://maps.app.goo.gl/SUbmDHtScKJprBBJ6', null)
on conflict do nothing;
