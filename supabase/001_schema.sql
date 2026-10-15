-- =====================================================================
--  Dolina Darts Club — base de données, version 1 (phase 1)
--  À coller UNE SEULE FOIS dans Supabase › SQL Editor, puis « Run ».
--
--  Contenu :
--    1. Profils des joueurs (+ coordonnées privées)
--    2. Équipes et rattachements (validation par le capitaine)
--    3. Actualités
--    4. Paramètres du club (seuil du classement…)
--    5. Parties, camps, joueurs et volées (scorer X01)
--    6. Règles d'accès (RLS) : qui peut lire / écrire quoi
--    7. Fonctions utiles (suppression de compte…)
--
--  Principe de sécurité : la clé publique du site ne donne AUCUN droit
--  par elle-même. Chaque table a la sécurité par ligne (RLS) activée,
--  et seules les règles écrites ci-dessous ouvrent un accès.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PROFILS
-- ---------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  first_name    text not null check (char_length(first_name) between 1 and 60),
  last_name     text not null check (char_length(last_name) between 1 and 60),
  nickname      text check (char_length(nickname) <= 40),
  hand          text check (hand in ('droitier', 'gaucher')),
  dart_weight   numeric(4,1) check (dart_weight between 10 and 50),
  photo_path    text,
  photo_consent boolean not null default false,
  -- pending = en attente de l'admin ; active = validé ; refused = refusé
  status        text not null default 'pending' check (status in ('pending', 'active', 'refused')),
  role          text not null default 'member'  check (role in ('member', 'admin')),
  created_at    timestamptz not null default now(),
  validated_at  timestamptz
);

comment on table public.profiles is 'Un profil par compte. Visible des membres validés.';

-- Coordonnées : visibles uniquement par le joueur lui-même et les admins.
create table public.profile_private (
  id                  uuid primary key references public.profiles (id) on delete cascade,
  email               text,
  phone               text not null default '',
  privacy_accepted_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. ÉQUIPES
-- ---------------------------------------------------------------------

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(name) between 1 and 40),
  captain_id  uuid references public.profiles (id) on delete set null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- Un capitaine ne gère qu'une seule équipe.
create unique index teams_one_team_per_captain on public.teams (captain_id) where captain_id is not null;

insert into public.teams (name, sort_order) values
  ('Dolinos', 1), ('Dolina 1', 2), ('Dolina 2', 3);

create table public.team_members (
  team_id      uuid not null references public.teams (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  -- pending = demande envoyée ; accepted = validé par le capitaine ou un admin
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id) on delete set null,
  primary key (team_id, profile_id)
);


-- ---------------------------------------------------------------------
-- 3. ACTUALITÉS
-- ---------------------------------------------------------------------

create table public.articles (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 160),
  body         text not null default '',
  category     text not null check (category in ('annonce', 'resultat', 'vie_club', 'evenement')),
  image_path   text,
  published    boolean not null default false,
  published_at timestamptz,
  author_id    uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4. PARAMÈTRES DU CLUB
-- ---------------------------------------------------------------------

create table public.settings (
  key   text primary key,
  value jsonb not null
);

insert into public.settings (key, value) values
  ('ranking_min_legs', '5'::jsonb);   -- manches minimum pour apparaître au classement


-- ---------------------------------------------------------------------
-- 5. PARTIES (scorer X01)
-- ---------------------------------------------------------------------

create table public.games (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid references public.profiles (id) on delete set null,
  variant      text not null check (variant in ('301', '501', 'libre')),
  start_score  int  not null check (start_score between 2 and 9999),
  mode         text not null check (mode in ('single', 'double', 'bot')),
  legs_kind    text not null check (legs_kind in ('best_of', 'first_to')),
  legs_n       int  not null check (legs_n between 1 and 99),
  sets_kind    text check (sets_kind in ('best_of', 'first_to')),
  sets_n       int  check (sets_n between 1 and 99),
  visibility   text not null default 'public' check (visibility in ('public', 'private')),
  status       text not null default 'live'   check (status in ('live', 'finished', 'abandoned')),
  winner_side  smallint check (winner_side between 1 and 4),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check ((sets_kind is null) = (sets_n is null)),
  check (variant <> '301' or start_score = 301),
  check (variant <> '501' or start_score = 501)
);

create index games_live_public on public.games (status, visibility, created_at desc);

-- Un « camp » : un joueur en individuel, une doublette en 2v2, ou le dartbot.
create table public.game_sides (
  game_id  uuid not null references public.games (id) on delete cascade,
  side     smallint not null check (side between 1 and 4),
  name     text check (char_length(name) <= 40),   -- nom de l'équipe en 2v2
  is_bot   boolean not null default false,
  primary key (game_id, side)
);

create table public.game_players (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null,
  side          smallint not null,
  profile_id    uuid references public.profiles (id) on delete set null,
  guest_name    text check (char_length(guest_name) between 1 and 40),
  -- Nom affiché, figé au moment de la partie (« Ancien joueur » après suppression)
  display_name  text not null default '',
  throw_order   smallint not null default 1 check (throw_order between 1 and 2),
  foreign key (game_id, side) references public.game_sides (game_id, side) on delete cascade,
  unique (game_id, profile_id)
);

create index game_players_profile on public.game_players (profile_id);

create table public.visits (
  id                bigint generated always as identity primary key,
  game_id           uuid not null references public.games (id) on delete cascade,
  set_no            smallint not null default 1 check (set_no >= 1),
  leg_no            smallint not null check (leg_no >= 1),
  visit_no          smallint not null check (visit_no >= 1),
  side              smallint not null check (side between 1 and 4),
  player_id         uuid references public.game_players (id) on delete set null,
  score             smallint not null check (score between 0 and 180 and score not in (179, 178, 176, 175, 173, 172, 169, 166, 163)),
  remaining_before  smallint not null check (remaining_before >= 0),
  is_bust           boolean  not null default false,
  is_checkout       boolean  not null default false,
  darts_used        smallint not null default 3 check (darts_used between 1 and 3),
  darts_at_double   smallint not null default 0 check (darts_at_double between 0 and 3),
  created_at        timestamptz not null default now(),
  unique (game_id, set_no, leg_no, side, visit_no),
  check (not (is_bust and is_checkout)),
  check (is_checkout or darts_used = 3),        -- 1 ou 2 fléchettes : seulement sur la volée de finish
  check (darts_at_double <= darts_used)
);

create index visits_game on public.visits (game_id, set_no, leg_no, visit_no);


-- ---------------------------------------------------------------------
-- 6. FONCTIONS D'AIDE AUX DROITS
--    (security definer : elles lisent les tables sans boucler sur les règles)
-- ---------------------------------------------------------------------

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'admin');
$$;

create or replace function public.is_captain_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams t
    join public.profiles p on p.id = t.captain_id
    where t.id = p_team and t.captain_id = auth.uid() and p.status = 'active'
  );
$$;

-- Le capitaine connecté a-t-il une demande de ce joueur pour son équipe ?
create or replace function public.is_captain_of_requester(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = p_profile and t.captain_id = auth.uid()
  );
$$;

create or replace function public.can_edit_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game and (g.created_by = auth.uid() or public.is_admin())
  ) and public.is_active_member();
$$;


-- ---------------------------------------------------------------------
-- 7. AUTOMATISMES (triggers)
-- ---------------------------------------------------------------------

-- 7.1 À l'inscription : création du profil, des coordonnées et des demandes d'équipe
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  w    text  := meta ->> 'dart_weight';
begin
  insert into public.profiles (id, first_name, last_name, nickname, hand, dart_weight, photo_consent)
  values (
    new.id,
    left(coalesce(nullif(trim(meta ->> 'first_name'), ''), '?'), 60),
    left(coalesce(nullif(trim(meta ->> 'last_name'),  ''), '?'), 60),
    left(nullif(trim(meta ->> 'nickname'), ''), 40),
    case when meta ->> 'hand' in ('droitier', 'gaucher') then meta ->> 'hand' end,
    case when w ~ '^[0-9]{1,2}(\.[0-9])?$' and w::numeric between 10 and 50 then w::numeric end,
    coalesce((meta ->> 'photo_consent') = 'true', false)
  );

  insert into public.profile_private (id, email, phone)
  values (new.id, new.email, left(coalesce(trim(meta ->> 'phone'), ''), 30));

  if jsonb_typeof(meta -> 'teams') = 'array' then
    insert into public.team_members (team_id, profile_id)
    select t.id, new.id
    from public.teams t
    where t.id::text in (select jsonb_array_elements_text(meta -> 'teams'))
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7.2 Un membre ne peut pas modifier lui-même son statut ni son rôle
create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    new.id           := old.id;
    new.status       := old.status;
    new.role         := old.role;
    new.created_at   := old.created_at;
    new.validated_at := old.validated_at;
  end if;
  if new.status = 'active' and old.status is distinct from 'active' then
    new.validated_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- 7.3 Rattachement à une équipe : le capitaine ne change que la décision,
--     et seulement pour un compte déjà validé par l'admin
create or replace function public.protect_team_member()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    new.team_id      := old.team_id;
    new.profile_id   := old.profile_id;
    new.requested_at := old.requested_at;
    if new.status = 'accepted' and not exists (
      select 1 from public.profiles where id = new.profile_id and status = 'active'
    ) then
      raise exception 'Le compte doit d''abord être validé par un admin.';
    end if;
  end if;
  if new.status is distinct from old.status then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger team_members_protect before update on public.team_members
  for each row execute function public.protect_team_member();

-- 7.4 Nom affiché d'un joueur : toujours tiré du profil (impossible à falsifier)
create or replace function public.set_player_display_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Compte supprimé : le joueur devient « Ancien joueur »
  if tg_op = 'UPDATE' and new.profile_id is null and old.profile_id is not null and new.guest_name is null then
    new.display_name := 'Ancien joueur';
    return new;
  end if;
  if new.profile_id is not null then
    select p.first_name || ' ' || p.last_name into new.display_name
    from public.profiles p where p.id = new.profile_id;
    new.guest_name := null;
  elsif new.guest_name is not null then
    new.display_name := new.guest_name;
  elsif exists (select 1 from public.game_sides s where s.game_id = new.game_id and s.side = new.side and s.is_bot) then
    new.display_name := 'Dartbot';
  else
    raise exception 'Un joueur doit être un membre, un invité ou le dartbot.';
  end if;
  return new;
end;
$$;

create trigger game_players_name before insert or update of profile_id, guest_name on public.game_players
  for each row execute function public.set_player_display_name();

-- 7.5 Dates de mise à jour
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger games_touch    before update on public.games    for each row execute function public.touch_updated_at();
create trigger articles_touch before update on public.articles for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 8. RÈGLES D'ACCÈS (Row Level Security)
-- ---------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.profile_private enable row level security;
alter table public.teams           enable row level security;
alter table public.team_members    enable row level security;
alter table public.articles        enable row level security;
alter table public.settings        enable row level security;
alter table public.games           enable row level security;
alter table public.game_sides      enable row level security;
alter table public.game_players    enable row level security;
alter table public.visits          enable row level security;

-- Profils : soi-même, les admins, les membres validés (profils validés),
-- et le capitaine pour les joueurs qui demandent son équipe.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or (public.is_active_member() and status = 'active')
    or public.is_captain_of_requester(id)
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Coordonnées privées : soi-même et les admins
create policy private_select on public.profile_private for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy private_update on public.profile_private for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Équipes : visibles de tous (page publique), modifiées par les admins
create policy teams_select on public.teams for select to anon, authenticated using (true);
create policy teams_admin  on public.teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Rattachements
create policy tm_select on public.team_members for select to authenticated
  using (profile_id = auth.uid() or public.is_active_member());
create policy tm_insert on public.team_members for insert to authenticated
  with check ((profile_id = auth.uid() and status = 'pending') or public.is_admin());
create policy tm_update on public.team_members for update to authenticated
  using (public.is_admin() or public.is_captain_of(team_id))
  with check (public.is_admin() or public.is_captain_of(team_id));
create policy tm_delete on public.team_members for delete to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- Actualités : publiées = publiques ; brouillons et écriture = admins
create policy articles_select on public.articles for select to anon, authenticated
  using (published or public.is_admin());
create policy articles_admin on public.articles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Paramètres : lus par les membres validés, modifiés par les admins
create policy settings_select on public.settings for select to authenticated
  using (public.is_active_member());
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Parties : publiques visibles de tous ; toutes visibles des membres validés
create policy games_select on public.games for select to anon, authenticated
  using (visibility = 'public' or public.is_active_member());
create policy games_insert on public.games for insert to authenticated
  with check (public.is_active_member() and created_by = auth.uid());
create policy games_update on public.games for update to authenticated
  using (public.can_edit_game(id))
  with check (public.can_edit_game(id));
create policy games_delete on public.games for delete to authenticated
  using (public.is_admin());

-- Camps, joueurs, volées : visibles si la partie l'est ; modifiés par
-- le créateur de la partie ou un admin
create policy sides_select on public.game_sides for select to anon, authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
create policy sides_write on public.game_sides for all to authenticated
  using (public.can_edit_game(game_id)) with check (public.can_edit_game(game_id));

create policy players_select on public.game_players for select to anon, authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
create policy players_write on public.game_players for all to authenticated
  using (public.can_edit_game(game_id)) with check (public.can_edit_game(game_id));

create policy visits_select on public.visits for select to anon, authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
create policy visits_write on public.visits for all to authenticated
  using (public.can_edit_game(game_id)) with check (public.can_edit_game(game_id));


-- ---------------------------------------------------------------------
-- 9. SUPPRESSION DE SON COMPTE (RGPD)
--    Efface le profil, les stats personnelles et les parties en solo.
--    Les parties contre d'autres membres restent, avec « Ancien joueur ».
-- ---------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Non connecté.';
  end if;

  -- Parties sans aucun autre membre : supprimées
  delete from public.games g
  where exists (select 1 from public.game_players gp where gp.game_id = g.id and gp.profile_id = uid)
    and not exists (
      select 1 from public.game_players gp
      where gp.game_id = g.id and gp.profile_id is not null and gp.profile_id <> uid
    );

  -- Parties contre d'autres membres : anonymisées
  update public.game_players
     set display_name = 'Ancien joueur', profile_id = null
   where profile_id = uid;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------------
-- 10. SCORE EN DIRECT : diffusion des changements en temps réel
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.games, public.visits;

-- Fin du script.
