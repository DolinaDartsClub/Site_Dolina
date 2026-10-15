-- =====================================================================
--  Étape T1 : tournois — création, code d'accès et inscriptions
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--
--  Ce script ne modifie aucune table existante : il ajoute
--  - tournaments          : un tournoi (code unique, format, statut…)
--  - tournament_entries   : les inscrits (membre, invité ou doublette)
--  et les fonctions qui protègent les inscriptions (doublons, places,
--  tournoi fermé). Toutes les règles sont vérifiées par la base :
--  l'interface ne peut pas les contourner.
--
--  Statuts : draft = en préparation (inscriptions fermées)
--            open = inscriptions ouvertes
--            running = en cours (étape T2) · finished = terminé
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.tournaments (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  description      text not null default '' check (char_length(description) <= 1000),
  team_mode        text not null default 'single' check (team_mode in ('single', 'double')),
  format           text not null check (format in ('knockout', 'pools')),
  max_participants int  not null default 16 check (max_participants between 2 and 64),
  pools_count      int  check (pools_count between 1 and 16),       -- nombre de poules (réglable jusqu'au lancement)
  pool_qualifiers  int  check (pool_qualifiers between 1 and 8),    -- qualifiés par poule
  third_place      boolean not null default false,                   -- match pour la 3e place
  public_matches   boolean not null default true,                    -- matchs visibles dans « Matchs en cours »
  status           text not null default 'draft' check (status in ('draft', 'open', 'running', 'finished')),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  check (format = 'knockout' or pool_qualifiers is not null)
);

comment on table public.tournaments is 'Tournois créés par les membres. Visibles uniquement par l''organisateur, les inscrits et les admins.';

-- Un inscrit : un membre (profile_id), un invité (guest_name) ;
-- en double, une doublette nommée (team_name) avec un partenaire,
-- membre (partner_profile_id) ou invité (partner_guest_name).
create table if not exists public.tournament_entries (
  id                 uuid primary key default gen_random_uuid(),
  tournament_id      uuid not null references public.tournaments (id) on delete cascade,
  profile_id         uuid references public.profiles (id) on delete set null,
  guest_name         text check (char_length(btrim(guest_name)) between 1 and 40),
  partner_profile_id uuid references public.profiles (id) on delete set null,
  partner_guest_name text check (char_length(btrim(partner_guest_name)) between 1 and 40),
  team_name          text check (char_length(btrim(team_name)) between 1 and 40),
  added_by           uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists tournament_entries_tournoi on public.tournament_entries (tournament_id, created_at);
-- Un membre n'est inscrit qu'une fois par tournoi (comme joueur ou comme partenaire)
create unique index if not exists tournament_entries_un_compte on public.tournament_entries (tournament_id, profile_id) where profile_id is not null;
create unique index if not exists tournament_entries_un_partenaire on public.tournament_entries (tournament_id, partner_profile_id) where partner_profile_id is not null;
create index if not exists tournament_entries_profil on public.tournament_entries (profile_id);
create index if not exists tournament_entries_partenaire on public.tournament_entries (partner_profile_id);


-- ---------------------------------------------------------------------
-- 2. FONCTIONS D'AIDE (droits)
-- ---------------------------------------------------------------------

-- Organisateur du tournoi, ou admin du site
create or replace function public.tournoi_organisateur(p_tournoi uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_member() and (
    public.is_admin()
    or exists (select 1 from public.tournaments t where t.id = p_tournoi and t.created_by = auth.uid())
  );
$$;

-- Inscrit au tournoi (comme joueur ou comme partenaire de doublette)
create or replace function public.tournoi_participant(p_tournoi uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.tournament_entries e
    where e.tournament_id = p_tournoi and (e.profile_id = auth.uid() or e.partner_profile_id = auth.uid())
  );
$$;

-- Code à 6 caractères, sans les caractères que l'on confond (O/0, I/1)
create or replace function public.generer_code_tournoi()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.tournaments where code = c);
  end loop;
  return c;
end;
$$;

-- Nom affiché d'un inscrit (« Ancien joueur » si le compte a été supprimé)
create or replace function public.nom_inscrit(e public.tournament_entries)
returns text language sql stable security definer set search_path = public as $$
  select case
    when e.team_name is not null then e.team_name
    when e.profile_id is not null then (select public.nom_affiche(p) from public.profiles p where p.id = e.profile_id)
    else coalesce(e.guest_name, 'Ancien joueur')
  end;
$$;


-- ---------------------------------------------------------------------
-- 3. AUTOMATISMES (triggers)
-- ---------------------------------------------------------------------

-- Création / modification d'un tournoi
create or replace function public.tournoi_avant_ecriture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nb int;
  interne boolean := coalesce(current_setting('dolina.interne', true), '') = 'oui';
begin
  if tg_op = 'INSERT' then
    new.code := public.generer_code_tournoi();
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    if new.status not in ('draft', 'open') then new.status := 'draft'; end if;
    new.started_at := null;
    new.finished_at := null;
  else
    -- Ce qui ne change jamais
    new.id := old.id;
    new.code := old.code;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    -- Le lancement et la fin du tournoi passent par les fonctions dédiées (étape T2)
    if new.status is distinct from old.status and not interne
       and (new.status in ('running', 'finished') or old.status in ('running', 'finished')) then
      raise exception 'Le statut « en cours » ou « terminé » se règle au lancement et à la fin du tournoi.';
    end if;
    -- Paramètres modifiables uniquement avant le lancement
    if old.status in ('running', 'finished') and not interne and (
         new.team_mode is distinct from old.team_mode or new.format is distinct from old.format
      or new.max_participants is distinct from old.max_participants or new.pools_count is distinct from old.pools_count
      or new.pool_qualifiers is distinct from old.pool_qualifiers or new.third_place is distinct from old.third_place
      or new.public_matches is distinct from old.public_matches) then
      raise exception 'Le tournoi a commencé : ses paramètres ne peuvent plus être modifiés.';
    end if;
    select count(*) into nb from public.tournament_entries where tournament_id = old.id;
    if new.team_mode is distinct from old.team_mode and nb > 0 then
      raise exception 'Des inscrits existent déjà : le choix individuel / double ne peut plus changer.';
    end if;
    if new.max_participants < nb then
      raise exception 'Il y a déjà % inscrits : le nombre de places ne peut pas être inférieur.', nb;
    end if;
  end if;
  if new.format = 'knockout' then
    new.pools_count := null;
    new.pool_qualifiers := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tournois_avant_ecriture on public.tournaments;
create trigger tournois_avant_ecriture before insert or update on public.tournaments
  for each row execute function public.tournoi_avant_ecriture();

-- Inscription : tournoi ouvert, places disponibles, pas de doublon
create or replace function public.inscription_avant_ajout()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  nb int;
  doublon uuid;
begin
  -- Verrou sur le tournoi : deux inscriptions simultanées ne peuvent pas dépasser le nombre de places
  select * into t from public.tournaments where id = new.tournament_id for update;
  if not found then
    raise exception 'Ce tournoi n''existe pas.';
  end if;
  if t.status = 'running' then
    raise exception 'Les inscriptions sont terminées : le tournoi a déjà commencé.';
  elsif t.status = 'finished' then
    raise exception 'Ce tournoi est terminé.';
  end if;

  select count(*) into nb from public.tournament_entries where tournament_id = t.id;
  if nb >= t.max_participants then
    raise exception 'Le tournoi est complet (% places).', t.max_participants;
  end if;

  -- Nettoyage des noms saisis
  new.guest_name := nullif(btrim(new.guest_name), '');
  new.partner_guest_name := nullif(btrim(new.partner_guest_name), '');
  new.team_name := nullif(btrim(new.team_name), '');
  if new.profile_id is not null then new.guest_name := null; end if;
  if new.partner_profile_id is not null then new.partner_guest_name := null; end if;

  if new.profile_id is null and new.guest_name is null then
    raise exception 'Indiquez un membre ou le nom d''un invité.';
  end if;

  if t.team_mode = 'double' then
    if new.team_name is null then
      raise exception 'Donnez un nom à la doublette.';
    end if;
    if new.partner_profile_id is null and new.partner_guest_name is null then
      raise exception 'Indiquez le partenaire de la doublette (membre ou invité).';
    end if;
    if new.partner_profile_id is not null and new.partner_profile_id = new.profile_id then
      raise exception 'Le partenaire doit être une autre personne.';
    end if;
    if exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and lower(e.team_name) = lower(new.team_name)) then
      raise exception 'Une doublette s''appelle déjà « % » dans ce tournoi.', new.team_name;
    end if;
  else
    new.team_name := null;
    new.partner_profile_id := null;
    new.partner_guest_name := null;
  end if;

  -- Un membre ne figure qu'une fois dans le tournoi, comme joueur ou comme partenaire
  select x into doublon from unnest(array[new.profile_id, new.partner_profile_id]) x
  where x is not null and exists (
    select 1 from public.tournament_entries e
    where e.tournament_id = t.id and (e.profile_id = x or e.partner_profile_id = x)
  ) limit 1;
  if doublon is not null then
    if doublon = auth.uid() then
      raise exception 'Vous êtes déjà inscrit à ce tournoi.';
    end if;
    raise exception '% est déjà inscrit à ce tournoi.', (select public.nom_affiche(p) from public.profiles p where p.id = doublon);
  end if;

  -- Un invité ne figure qu'une fois (même nom)
  if new.guest_name is not null and exists (
    select 1 from public.tournament_entries e where e.tournament_id = t.id and lower(e.guest_name) = lower(new.guest_name)
  ) then
    raise exception 'Un invité nommé « % » est déjà inscrit.', new.guest_name;
  end if;

  new.added_by := coalesce(auth.uid(), new.added_by);
  return new;
end;
$$;

drop trigger if exists inscriptions_avant_ajout on public.tournament_entries;
create trigger inscriptions_avant_ajout before insert on public.tournament_entries
  for each row execute function public.inscription_avant_ajout();

-- Désinscription : seulement avant le lancement du tournoi
create or replace function public.inscription_avant_retrait()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st text;
begin
  select status into st from public.tournaments where id = old.tournament_id;
  -- Tournoi supprimé (suppression en cascade) : rien à vérifier
  if st is null then return old; end if;
  if st in ('running', 'finished') and coalesce(current_setting('dolina.interne', true), '') <> 'oui' then
    raise exception 'Le tournoi a commencé : les inscrits ne peuvent plus être retirés (l''organisateur peut déclarer un forfait).';
  end if;
  return old;
end;
$$;

drop trigger if exists inscriptions_avant_retrait on public.tournament_entries;
create trigger inscriptions_avant_retrait before delete on public.tournament_entries
  for each row execute function public.inscription_avant_retrait();

-- Modification d'un inscrit (nom de doublette, partenaire) : avant le lancement uniquement
create or replace function public.inscription_avant_modif()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st text;
begin
  select status into st from public.tournaments where id = old.tournament_id;
  -- Après le lancement, seule l'anonymisation d'un compte supprimé (identifiant remis à vide) est permise
  if st in ('running', 'finished') and coalesce(current_setting('dolina.interne', true), '') <> 'oui' and (
       (new.profile_id is distinct from old.profile_id and new.profile_id is not null)
    or (new.partner_profile_id is distinct from old.partner_profile_id and new.partner_profile_id is not null)
    or new.team_name is distinct from old.team_name
    or new.guest_name is distinct from old.guest_name
    or new.partner_guest_name is distinct from old.partner_guest_name) then
    raise exception 'Le tournoi a commencé : les inscrits ne peuvent plus être modifiés.';
  end if;
  new.id := old.id;
  new.tournament_id := old.tournament_id;
  new.created_at := old.created_at;
  new.team_name := nullif(btrim(new.team_name), '');
  return new;
end;
$$;

drop trigger if exists inscriptions_avant_modif on public.tournament_entries;
create trigger inscriptions_avant_modif before update on public.tournament_entries
  for each row execute function public.inscription_avant_modif();


-- ---------------------------------------------------------------------
-- 4. DROITS (RLS)
-- ---------------------------------------------------------------------

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;

-- Remarque : pour l'organisateur, la condition porte directement sur la ligne
-- (created_by = auth.uid()) afin que le tournoi soit lisible dès sa création.
drop policy if exists tournois_lecture on public.tournaments;
create policy tournois_lecture on public.tournaments for select to authenticated
  using ((created_by = auth.uid() and public.is_active_member()) or public.is_admin() or public.tournoi_participant(id));

drop policy if exists tournois_creation on public.tournaments;
create policy tournois_creation on public.tournaments for insert to authenticated
  with check (public.is_active_member() and created_by = auth.uid());

drop policy if exists tournois_modification on public.tournaments;
create policy tournois_modification on public.tournaments for update to authenticated
  using ((created_by = auth.uid() and public.is_active_member()) or public.is_admin())
  with check ((created_by = auth.uid() and public.is_active_member()) or public.is_admin());

drop policy if exists tournois_suppression on public.tournaments;
create policy tournois_suppression on public.tournaments for delete to authenticated
  using ((created_by = auth.uid() and public.is_active_member()) or public.is_admin());

drop policy if exists inscrits_lecture on public.tournament_entries;
create policy inscrits_lecture on public.tournament_entries for select to authenticated
  using (public.tournoi_organisateur(tournament_id) or public.tournoi_participant(tournament_id));

-- Ajout manuel (membre ou invité) : organisateur uniquement.
-- Un membre rejoint lui-même un tournoi avec la fonction rejoindre_tournoi (code).
drop policy if exists inscrits_ajout on public.tournament_entries;
create policy inscrits_ajout on public.tournament_entries for insert to authenticated
  with check (public.tournoi_organisateur(tournament_id));

drop policy if exists inscrits_modification on public.tournament_entries;
create policy inscrits_modification on public.tournament_entries for update to authenticated
  using (public.tournoi_organisateur(tournament_id)) with check (public.tournoi_organisateur(tournament_id));

-- Retrait : l'organisateur, ou l'inscrit lui-même (se désinscrire)
drop policy if exists inscrits_retrait on public.tournament_entries;
create policy inscrits_retrait on public.tournament_entries for delete to authenticated
  using (public.tournoi_organisateur(tournament_id) or (profile_id = auth.uid() and public.is_active_member()));


-- ---------------------------------------------------------------------
-- 5. REJOINDRE UN TOURNOI AVEC SON CODE
--    Le code identifie le tournoi ; l'inscription est liée au compte connecté.
-- ---------------------------------------------------------------------

create or replace function public.normaliser_code(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Aperçu avant de rejoindre (nom, format, places…)
create or replace function public.apercu_tournoi(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  c text := public.normaliser_code(p_code);
  t public.tournaments;
  nb int;
begin
  if not public.is_active_member() then
    raise exception 'Votre compte doit être validé par un admin pour rejoindre un tournoi.';
  end if;
  if c !~ '^[A-Z0-9]{6}$' then
    raise exception 'Le code d''un tournoi compte 6 caractères (lettres et chiffres).';
  end if;
  select * into t from public.tournaments where code = c;
  if not found then
    raise exception 'Aucun tournoi ne correspond au code « % ». Vérifiez-le auprès de l''organisateur.', c;
  end if;
  select count(*) into nb from public.tournament_entries where tournament_id = t.id;
  return json_build_object(
    'id', t.id,
    'code', t.code,
    'name', t.name,
    'description', t.description,
    'format', t.format,
    'team_mode', t.team_mode,
    'status', t.status,
    'inscrits', nb,
    'max_participants', t.max_participants,
    'organisateur', (select public.nom_affiche(p) from public.profiles p where p.id = t.created_by),
    'deja_inscrit', public.tournoi_participant(t.id),
    'organise', t.created_by = auth.uid()
  );
end;
$$;

create or replace function public.rejoindre_tournoi(
  p_code text,
  p_team_name text default null,
  p_partner_profile uuid default null,
  p_partner_guest text default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  c text := public.normaliser_code(p_code);
  t public.tournaments;
begin
  if not public.is_active_member() then
    raise exception 'Votre compte doit être validé par un admin pour rejoindre un tournoi.';
  end if;
  select * into t from public.tournaments where code = c;
  if not found then
    raise exception 'Aucun tournoi ne correspond au code « % ». Vérifiez-le auprès de l''organisateur.', c;
  end if;
  if public.tournoi_participant(t.id) then
    raise exception 'Vous êtes déjà inscrit à ce tournoi.';
  end if;
  if t.status = 'draft' then
    raise exception 'Les inscriptions à ce tournoi ne sont pas encore ouvertes.';
  end if;
  if p_partner_profile is not null and not exists (select 1 from public.profiles where id = p_partner_profile and status = 'active') then
    raise exception 'Ce partenaire n''est pas un membre validé.';
  end if;
  -- Les autres vérifications (places, doublons, tournoi commencé) sont faites par le trigger d'inscription
  insert into public.tournament_entries (tournament_id, profile_id, team_name, partner_profile_id, partner_guest_name)
  values (t.id, auth.uid(), p_team_name, p_partner_profile, p_partner_guest);
  return t.id;
end;
$$;

revoke execute on function public.apercu_tournoi(text) from anon;
revoke execute on function public.rejoindre_tournoi(text, text, uuid, text) from anon;
grant execute on function public.apercu_tournoi(text) to authenticated;
grant execute on function public.rejoindre_tournoi(text, text, uuid, text) to authenticated;

-- Demande à Supabase de relire la structure de la base
notify pgrst, 'reload schema';
