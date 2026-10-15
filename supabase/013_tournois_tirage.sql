-- =====================================================================
--  Étape T2 : tournois — lancement, tirage, poules, arbre, matchs
--  À exécuter une fois dans Supabase (après 012) : SQL Editor > New query > Run
--
--  Ajoute :
--  - le format des matchs de chaque phase (choisi au lancement)
--  - la poule et la place dans le tirage de chaque inscrit
--  - tournament_matches : tous les matchs du tournoi (poules et arbre)
--  - lancer_tournoi / annuler_lancement : réservés à l'organisateur
--  - tournoi_detail : la page d'un tournoi (inscrits, poules, arbre)
--  - tournois_en_cours : le bloc de l'accueil, visible des visiteurs
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. COLONNES ET TABLE DES MATCHS
-- ---------------------------------------------------------------------

alter table public.tournaments add column if not exists pool_format  jsonb;   -- format des matchs de poule
alter table public.tournaments add column if not exists final_format jsonb;   -- format de la phase finale

alter table public.tournament_entries add column if not exists pool_no int;   -- poule (1 = A, 2 = B…)
alter table public.tournament_entries add column if not exists seed int;      -- ordre du tirage

create table if not exists public.tournament_matches (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  match_no       int  not null,                         -- numéro affiché (M1, M2…), ordre de jeu conseillé
  phase          text not null check (phase in ('pool', 'final')),
  pool_no        int,                                   -- poules : numéro de la poule
  round_no       int  not null,                         -- poules : journée ; arbre : tour (1 = premier tour)
  position       int  not null default 1,               -- arbre : place dans le tour (1, 2…)
  is_third_place boolean not null default false,
  entry_a        uuid references public.tournament_entries (id) on delete set null,
  entry_b        uuid references public.tournament_entries (id) on delete set null,
  -- waiting = joueurs pas encore connus ; ready = à jouer ; live = en cours ;
  -- done = terminé ; bye = exemption (un seul joueur, qualifié d'office)
  status         text not null default 'waiting' check (status in ('waiting', 'ready', 'live', 'done', 'bye')),
  winner_entry   uuid references public.tournament_entries (id) on delete set null,
  score_a        int,                                   -- manches (ou sets) gagnées
  score_b        int,
  legs_a         int,                                   -- manches gagnées (pour le départage des poules)
  legs_b         int,
  forfeit        boolean not null default false,
  game_id        uuid references public.games (id) on delete set null,
  next_match_id  uuid references public.tournament_matches (id) on delete set null,
  next_slot      text check (next_slot in ('a', 'b')),
  loser_match_id uuid references public.tournament_matches (id) on delete set null,   -- demi-finale → match pour la 3e place
  loser_slot     text check (loser_slot in ('a', 'b')),
  validated_at   timestamptz,
  validated_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (tournament_id, match_no)
);

create index if not exists tournament_matches_tournoi on public.tournament_matches (tournament_id, phase, round_no, position);
create index if not exists tournament_matches_partie on public.tournament_matches (game_id);

alter table public.tournament_matches enable row level security;

drop policy if exists matchs_tournoi_lecture on public.tournament_matches;
create policy matchs_tournoi_lecture on public.tournament_matches for select to authenticated
  using (public.tournoi_organisateur(tournament_id) or public.tournoi_participant(tournament_id));
-- Aucune écriture directe : tout passe par les fonctions ci-dessous (sécurité côté base)


-- ---------------------------------------------------------------------
-- 2. CONTRÔLE DU FORMAT DES MATCHS
--    { variant: '301'|'501'|'libre', start_score, legs_kind, legs_n, sets_kind, sets_n }
--    Mêmes règles que le scorer et la page Jouer.
-- ---------------------------------------------------------------------

create or replace function public.verifier_format_match(f jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v text := f ->> 'variant';
  s int;
  lk text := f ->> 'legs_kind';
  ln int := nullif(f ->> 'legs_n', '')::int;
  sk text := nullif(f ->> 'sets_kind', '');
  sn int := nullif(f ->> 'sets_n', '')::int;
begin
  if v is null or v not in ('301', '501', 'libre') then
    raise exception 'Choisissez le jeu des matchs : 301, 501 ou score libre.';
  end if;
  s := case v when '301' then 301 when '501' then 501 else nullif(f ->> 'start_score', '')::int end;
  if s is null or s < 2 or s > 9999 then
    raise exception 'Le score de départ doit être compris entre 2 et 9999.';
  end if;
  if lk is null or lk not in ('best_of', 'first_to') or ln is null or ln < 1 or ln > 21 then
    raise exception 'Indiquez le nombre de manches (de 1 à 21).';
  end if;
  if lk = 'best_of' and ln % 2 = 0 then
    raise exception '« Au meilleur de » demande un nombre impair de manches.';
  end if;
  if sk is not null then
    if sk not in ('best_of', 'first_to') or sn is null or sn < 1 or sn > 15 then
      raise exception 'Indiquez le nombre de sets (de 1 à 15).';
    end if;
    if sk = 'best_of' and sn % 2 = 0 then
      raise exception '« Au meilleur de » demande un nombre impair de sets.';
    end if;
  else
    sn := null;
  end if;
  return jsonb_build_object('variant', v, 'start_score', s, 'legs_kind', lk, 'legs_n', ln, 'sets_kind', sk, 'sets_n', sn);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. GÉNÉRATION DE L'ARBRE (élimination directe)
--    Tirage au sort, exemptions données aux premières places du tirage,
--    réparties dans tout l'arbre (ordre classique 1-8-4-5-2-7-3-6).
-- ---------------------------------------------------------------------

-- Ordre classique des places dans un arbre de taille 2^k : [1, 8, 4, 5, 2, 7, 3, 6] pour 8
create or replace function public.ordre_arbre(taille int)
returns int[] language plpgsql immutable as $$
declare
  ordre int[] := array[1, 2];
  suivant int[];
  n int := 2;
  x int;
begin
  if taille < 2 then return array[1]; end if;
  while n < taille loop
    n := n * 2;
    suivant := '{}';
    foreach x in array ordre loop
      suivant := suivant || x || (n + 1 - x);
    end loop;
    ordre := suivant;
  end loop;
  return ordre;
end;
$$;

-- Crée l'arbre pour une liste d'inscrits déjà triée (place 1, 2, 3…).
-- Les matchs commencent au numéro p_premier_no. Renvoie le nombre de matchs créés.
create or replace function public.creer_arbre(p_tournoi uuid, p_inscrits uuid[], p_premier_no int, p_troisieme boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := coalesce(array_length(p_inscrits, 1), 0);
  taille int := 2;
  tours int := 1;
  ordre int[];
  r int; p int; nb int;
  no int := p_premier_no;
  ids uuid[];            -- identifiants des matchs, indexés (tour - 1) * taille + position
  m uuid;
  a uuid; b uuid;
  demi1 uuid; demi2 uuid; petite uuid;
begin
  if n < 2 then
    raise exception 'Il faut au moins 2 participants pour créer l''arbre.';
  end if;
  while taille < n loop taille := taille * 2; tours := tours + 1; end loop;
  ordre := public.ordre_arbre(taille);
  ids := array_fill(null::uuid, array[tours * taille]);

  -- Tous les matchs, du premier tour à la finale
  for r in 1..tours loop
    nb := taille / (2 ^ r)::int;
    for p in 1..nb loop
      insert into public.tournament_matches (tournament_id, match_no, phase, round_no, position)
      values (p_tournoi, no, 'final', r, p) returning id into m;
      ids[(r - 1) * taille + p] := m;
      no := no + 1;
    end loop;
  end loop;

  -- Liens vers le match suivant
  for r in 1..tours - 1 loop
    nb := taille / (2 ^ r)::int;
    for p in 1..nb loop
      update public.tournament_matches
         set next_match_id = ids[r * taille + ((p + 1) / 2)],
             next_slot = case when p % 2 = 1 then 'a' else 'b' end
       where id = ids[(r - 1) * taille + p];
    end loop;
  end loop;

  -- Match pour la 3e place : alimenté par les perdants des demi-finales
  if p_troisieme and tours >= 2 then
    insert into public.tournament_matches (tournament_id, match_no, phase, round_no, position, is_third_place)
    values (p_tournoi, no, 'final', tours, 2, true) returning id into petite;
    no := no + 1;
    demi1 := ids[(tours - 2) * taille + 1];
    demi2 := ids[(tours - 2) * taille + 2];
    update public.tournament_matches set loser_match_id = petite, loser_slot = 'a' where id = demi1;
    update public.tournament_matches set loser_match_id = petite, loser_slot = 'b' where id = demi2;
  end if;

  -- Premier tour : place du tirage → joueur (une place au-delà de n = exemption)
  for p in 1..taille / 2 loop
    a := case when ordre[2 * p - 1] <= n then p_inscrits[ordre[2 * p - 1]] end;
    b := case when ordre[2 * p] <= n then p_inscrits[ordre[2 * p]] end;
    m := ids[p];
    update public.tournament_matches set entry_a = a, entry_b = b,
      status = case when a is not null and b is not null then 'ready' else 'bye' end,
      winner_entry = case when a is null then b when b is null then a end
    where id = m;
  end loop;

  -- Les exemptés passent directement au tour suivant
  perform public.faire_avancer(id) from public.tournament_matches
   where tournament_id = p_tournoi and phase = 'final' and round_no = 1 and status = 'bye';

  return no - p_premier_no;
end;
$$;

-- Place le vainqueur (et le perdant, pour la 3e place) dans les matchs suivants
create or replace function public.faire_avancer(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.tournament_matches;
  perdant uuid;
begin
  select * into m from public.tournament_matches where id = p_match;
  if m.winner_entry is null then return; end if;
  if m.next_match_id is not null then
    if m.next_slot = 'a' then
      update public.tournament_matches set entry_a = m.winner_entry where id = m.next_match_id;
    else
      update public.tournament_matches set entry_b = m.winner_entry where id = m.next_match_id;
    end if;
    update public.tournament_matches set status = 'ready'
     where id = m.next_match_id and status = 'waiting' and entry_a is not null and entry_b is not null;
  end if;
  if m.loser_match_id is not null and m.status = 'done' then
    perdant := case when m.winner_entry = m.entry_a then m.entry_b else m.entry_a end;
    if m.loser_slot = 'a' then
      update public.tournament_matches set entry_a = perdant where id = m.loser_match_id;
    else
      update public.tournament_matches set entry_b = perdant where id = m.loser_match_id;
    end if;
    update public.tournament_matches set status = 'ready'
     where id = m.loser_match_id and status = 'waiting' and entry_a is not null and entry_b is not null;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. GÉNÉRATION DES POULES (chacun contre chacun)
--    Répartition équilibrée (écart d'au plus 1 joueur), tirage au sort.
--    Calendrier « en cercle » : chaque joueur joue une fois par journée
--    (ou est au repos si la poule est impaire).
-- ---------------------------------------------------------------------

create or replace function public.creer_poules(p_tournoi uuid, p_inscrits uuid[], p_poules int)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := coalesce(array_length(p_inscrits, 1), 0);
  i int; k int; r int; j int;
  joueurs uuid[];
  tmp uuid;
  journees int := 0;
  calendrier jsonb := '[]'::jsonb;    -- {poule, journee, a, b}
  no int := 1;
  ligne jsonb;
begin
  -- Répartition : 1er tiré → poule A, 2e → poule B…
  for i in 1..n loop
    update public.tournament_entries set pool_no = ((i - 1) % p_poules) + 1, seed = i where id = p_inscrits[i];
  end loop;

  for k in 1..p_poules loop
    select array_agg(id order by seed) into joueurs from public.tournament_entries
     where tournament_id = p_tournoi and pool_no = k;
    if coalesce(array_length(joueurs, 1), 0) % 2 = 1 then
      joueurs := joueurs || null::uuid;            -- place « repos »
    end if;
    for r in 1..array_length(joueurs, 1) - 1 loop
      for j in 1..array_length(joueurs, 1) / 2 loop
        if joueurs[j] is not null and joueurs[array_length(joueurs, 1) + 1 - j] is not null then
          calendrier := calendrier || jsonb_build_object('poule', k, 'journee', r,
            'a', joueurs[j], 'b', joueurs[array_length(joueurs, 1) + 1 - j]);
        end if;
      end loop;
      -- Rotation : le premier reste fixe, les autres tournent
      tmp := joueurs[array_length(joueurs, 1)];
      for j in reverse array_length(joueurs, 1)..3 loop
        joueurs[j] := joueurs[j - 1];
      end loop;
      joueurs[2] := tmp;
    end loop;
  end loop;

  -- Numérotation : journée par journée, poule par poule (ordre de jeu conseillé)
  for ligne in select value from jsonb_array_elements(calendrier)
               order by (value ->> 'journee')::int, (value ->> 'poule')::int loop
    insert into public.tournament_matches (tournament_id, match_no, phase, pool_no, round_no, entry_a, entry_b, status)
    values (p_tournoi, no, 'pool', (ligne ->> 'poule')::int, (ligne ->> 'journee')::int,
            (ligne ->> 'a')::uuid, (ligne ->> 'b')::uuid, 'ready');
    no := no + 1;
  end loop;
  return no - 1;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. LANCER LE TOURNOI (organisateur)
-- ---------------------------------------------------------------------

create or replace function public.lancer_tournoi(p_tournoi uuid, p_format jsonb, p_poules int default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  f jsonb := public.verifier_format_match(p_format);
  n int;
  tirage uuid[];
  plus_petite int;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found or not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut le lancer.';
  end if;
  if t.status not in ('draft', 'open') then
    raise exception 'Ce tournoi est déjà lancé.';
  end if;

  -- Tirage au sort de l'ordre des inscrits
  select array_agg(id order by random()) into tirage from public.tournament_entries where tournament_id = p_tournoi;
  n := coalesce(array_length(tirage, 1), 0);

  perform set_config('dolina.interne', 'oui', true);
  update public.tournament_entries set pool_no = null, seed = null where tournament_id = p_tournoi;
  delete from public.tournament_matches where tournament_id = p_tournoi;

  if t.format = 'knockout' then
    if n < 2 then
      raise exception 'Il faut au moins 2 participants pour lancer le tournoi.';
    end if;
    for i in 1..n loop
      update public.tournament_entries set seed = i where id = tirage[i];
    end loop;
    perform public.creer_arbre(p_tournoi, tirage, 1, t.third_place);
    update public.tournaments set status = 'running', started_at = now(), final_format = f, pools_count = null where id = p_tournoi;
  else
    if n < 3 then
      raise exception 'Il faut au moins 3 participants pour un tournoi avec poules.';
    end if;
    p_poules := coalesce(p_poules, t.pools_count, greatest(1, ceil(n / 4.0)::int));
    if p_poules < 1 or p_poules > 16 or n / p_poules < 2 then
      raise exception 'Avec % participants, choisissez entre 1 et % poules (2 joueurs minimum par poule).', n, least(16, n / 2);
    end if;
    plus_petite := n / p_poules;
    if t.pool_qualifiers > plus_petite then
      raise exception '% qualifiés par poule : impossible avec des poules de % joueurs. Réduisez le nombre de qualifiés ou de poules.', t.pool_qualifiers, plus_petite;
    end if;
    if t.pool_qualifiers * p_poules < 2 then
      raise exception 'Il faut au moins 2 qualifiés au total pour la phase finale.';
    end if;
    perform public.creer_poules(p_tournoi, tirage, p_poules);
    update public.tournaments set status = 'running', started_at = now(), pool_format = f, pools_count = p_poules where id = p_tournoi;
  end if;
end;
$$;

-- Annuler le lancement (erreur de tirage, joueur oublié…) : seulement si aucun match n'a commencé
create or replace function public.annuler_lancement(p_tournoi uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found or not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut annuler le lancement.';
  end if;
  if t.status <> 'running' then
    raise exception 'Ce tournoi n''est pas en cours.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and (status in ('live', 'done') or game_id is not null)) then
    raise exception 'Des matchs ont déjà été joués : le lancement ne peut plus être annulé.';
  end if;
  perform set_config('dolina.interne', 'oui', true);
  delete from public.tournament_matches where tournament_id = p_tournoi;
  update public.tournament_entries set pool_no = null, seed = null where tournament_id = p_tournoi;
  update public.tournaments set status = 'draft', started_at = null where id = p_tournoi;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. LECTURE : PAGE D'UN TOURNOI ET BLOC DE L'ACCUEIL
-- ---------------------------------------------------------------------

-- Tout ce qu'affiche la page d'un tournoi. Rôle : organisateur, participant
-- ou spectateur (tournoi lancé à matchs publics). Le code n'est donné
-- qu'à l'organisateur et aux participants.
create or replace function public.tournoi_detail(p_tournoi uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  t public.tournaments;
  role text;
begin
  select * into t from public.tournaments where id = p_tournoi;
  if not found then
    raise exception 'Ce tournoi n''existe pas.';
  end if;
  role := case
    when public.tournoi_organisateur(p_tournoi) then 'organisateur'
    when public.tournoi_participant(p_tournoi) then 'participant'
    when t.status in ('running', 'finished') and t.public_matches then 'spectateur'
  end;
  if role is null then
    raise exception 'Ce tournoi est réservé à ses participants. Rejoignez-le avec son code.';
  end if;

  return json_build_object(
    'role', role,
    'tournoi', json_build_object(
      'id', t.id, 'code', case when role <> 'spectateur' then t.code end,
      'name', t.name, 'description', t.description, 'team_mode', t.team_mode, 'format', t.format,
      'max_participants', t.max_participants, 'pools_count', t.pools_count, 'pool_qualifiers', t.pool_qualifiers,
      'third_place', t.third_place, 'public_matches', t.public_matches, 'status', t.status,
      'pool_format', t.pool_format, 'final_format', t.final_format,
      'created_by', t.created_by, 'created_at', t.created_at, 'started_at', t.started_at, 'finished_at', t.finished_at,
      'organisateur', (select public.nom_affiche(p) from public.profiles p where p.id = t.created_by)
    ),
    'inscrits', coalesce((
      select json_agg(json_build_object(
        'id', e.id, 'profile_id', e.profile_id, 'partner_profile_id', e.partner_profile_id,
        'nom', public.nom_inscrit(e),
        'detail', case
          when e.team_name is not null then
            coalesce((select public.nom_affiche(p) from public.profiles p where p.id = e.profile_id), e.guest_name, 'Ancien joueur')
            || ' & ' ||
            coalesce((select public.nom_affiche(p) from public.profiles p where p.id = e.partner_profile_id), e.partner_guest_name, 'Ancien joueur')
          when e.profile_id is null and e.guest_name is not null then 'Invité'
          else '' end,
        'invite', e.profile_id is null,
        'pool_no', e.pool_no, 'seed', e.seed, 'created_at', e.created_at
      ) order by e.created_at)
      from public.tournament_entries e where e.tournament_id = t.id), '[]'::json),
    'matchs', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'match_no', m.match_no, 'phase', m.phase, 'pool_no', m.pool_no, 'round_no', m.round_no,
        'position', m.position, 'is_third_place', m.is_third_place, 'entry_a', m.entry_a, 'entry_b', m.entry_b,
        'status', m.status, 'winner_entry', m.winner_entry, 'score_a', m.score_a, 'score_b', m.score_b,
        'legs_a', m.legs_a, 'legs_b', m.legs_b, 'forfeit', m.forfeit, 'game_id', m.game_id,
        'next_match_id', m.next_match_id, 'next_slot', m.next_slot, 'loser_match_id', m.loser_match_id, 'loser_slot', m.loser_slot
      ) order by m.match_no)
      from public.tournament_matches m where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;

-- Tournois en cours, pour l'accueil (visiteurs compris) : nom, format, avancement.
-- Ni code ni liste des inscrits.
create or replace function public.tournois_en_cours()
returns table (
  id uuid, name text, format text, team_mode text, public_matches boolean,
  inscrits int, matchs_total int, matchs_joues int, matchs_en_cours int,
  phase text, tour int, tours int, started_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.format, t.team_mode, t.public_matches,
    (select count(*)::int from public.tournament_entries e where e.tournament_id = t.id),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status <> 'bye'),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status = 'done'),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status = 'live'),
    case when exists (select 1 from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final') then 'final' else 'pool' end,
    (select min(m.round_no)::int from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final' and m.status in ('ready', 'live', 'waiting') and not m.is_third_place),
    (select max(m.round_no)::int from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final'),
    t.started_at
  from public.tournaments t
  where t.status = 'running'
  order by t.started_at desc
  limit 10;
$$;

-- Droits d'exécution : les fonctions internes ne sont appelables par personne
-- depuis le site (elles ne servent qu'à l'intérieur de la base).
revoke execute on function public.creer_arbre(uuid, uuid[], int, boolean) from public, anon, authenticated;
revoke execute on function public.creer_poules(uuid, uuid[], int) from public, anon, authenticated;
revoke execute on function public.faire_avancer(uuid) from public, anon, authenticated;
revoke execute on function public.lancer_tournoi(uuid, jsonb, int) from public, anon;
revoke execute on function public.annuler_lancement(uuid) from public, anon;
grant execute on function public.lancer_tournoi(uuid, jsonb, int) to authenticated;
grant execute on function public.annuler_lancement(uuid) to authenticated;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;
grant execute on function public.tournois_en_cours() to anon, authenticated;

-- Temps réel : la page d'un tournoi se met à jour quand un match change
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tournament_matches') then
    alter publication supabase_realtime add table public.tournament_matches;
  end if;
end $$;

notify pgrst, 'reload schema';
