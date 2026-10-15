-- =====================================================================
--  Étape T3 : tournois — lancer un match, valider le résultat,
--  faire avancer le vainqueur, phase finale, forfait, correction
--  À exécuter une fois dans Supabase (après 013, 014 et 015) :
--  SQL Editor > New query > Run
--
--  Le match de tournoi se joue avec le scorer existant : « Lancer le match »
--  crée une partie normale (table games) reliée au match. À la fin, le
--  résultat est validé : le vainqueur avance, le classement se met à jour.
--  Après validation, la partie est verrouillée ; seul l'organisateur
--  (ou un admin) peut remettre le match « à jouer ».
-- =====================================================================

-- Sécurité : colonnes des scripts précédents (si 015 n'a pas été exécuté)
alter table public.games add column if not exists show_checkout boolean not null default true;
alter table public.tournaments add column if not exists show_checkout boolean not null default true;

-- Une partie peut être reliée à un match de tournoi (une seule à la fois)
alter table public.games add column if not exists tournament_match_id uuid references public.tournament_matches (id) on delete set null;
create unique index if not exists games_un_par_match on public.games (tournament_match_id) where tournament_match_id is not null;


-- ---------------------------------------------------------------------
-- 1. CLASSEMENT D'UNE POULE (mêmes règles que l'affichage)
--    3 pts par victoire, 1 pt par défaite (0 en cas de forfait) ;
--    égalité : manches gagnées, puis victoires dans les matchs entre
--    les joueurs à égalité ; enfin l'ordre du tirage.
-- ---------------------------------------------------------------------

create or replace function public.classement_poule(p_tournoi uuid, p_poule int)
returns table (entry_id uuid, rang int, points int, manches int, victoires int, joues int)
language sql stable security definer set search_path = public as $$
  with joueurs as (
    select e.id, e.seed from public.tournament_entries e where e.tournament_id = p_tournoi and e.pool_no = p_poule
  ), res as (
    select m.*, case when m.winner_entry = m.entry_a then m.entry_b else m.entry_a end as perdant
    from public.tournament_matches m
    where m.tournament_id = p_tournoi and m.phase = 'pool' and m.pool_no = p_poule and m.status = 'done' and m.winner_entry is not null
  ), stats as (
    select j.id, j.seed,
      coalesce(sum(case when r.winner_entry = j.id then 3 when r.forfeit then 0 else 1 end) filter (where r.id is not null), 0)::int as points,
      coalesce(sum(case when r.entry_a = j.id then coalesce(r.legs_a, r.score_a, 0) else coalesce(r.legs_b, r.score_b, 0) end) filter (where r.id is not null), 0)::int as manches,
      count(*) filter (where r.winner_entry = j.id)::int as victoires,
      count(r.id)::int as joues
    from joueurs j left join res r on r.entry_a = j.id or r.entry_b = j.id
    group by j.id, j.seed
  ), entre as (
    -- victoires contre les joueurs à égalité (mêmes points, mêmes manches)
    select s.id, count(r.id)::int as h2h
    from stats s
    left join res r on r.winner_entry = s.id
      and exists (select 1 from stats o where o.id = r.perdant and o.points = s.points and o.manches = s.manches)
    group by s.id
  )
  select s.id, (row_number() over (order by s.points desc, s.manches desc, e.h2h desc, s.seed))::int,
         s.points, s.manches, s.victoires, s.joues
  from stats s join entre e on e.id = s.id
  order by 2;
$$;


-- ---------------------------------------------------------------------
-- 2. LANCER UN MATCH
--    Tout participant du tournoi (ou l'organisateur, ou un admin).
--    Crée la partie avec les joueurs et le format de la phase, puis
--    ouvre le scorer existant.
-- ---------------------------------------------------------------------

create or replace function public.lancer_match_tournoi(p_match uuid, p_premier int default 1)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  f jsonb;
  g uuid;
  autre int;
  cote int;
  e public.tournament_entries;
  occupe text;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then
    raise exception 'Ce match n''existe pas.';
  end if;
  select * into t from public.tournaments where id = m.tournament_id;
  if not (public.tournoi_organisateur(t.id) or public.tournoi_participant(t.id)) then
    raise exception 'Seuls les participants et l''organisateur du tournoi peuvent lancer un match.';
  end if;
  if t.status <> 'running' then
    raise exception 'Le tournoi n''est pas en cours.';
  end if;
  if m.status = 'live' then
    raise exception 'Ce match est déjà en cours : suivez-le en direct depuis le tournoi.';
  elsif m.status = 'done' then
    raise exception 'Ce match est déjà terminé.';
  elsif m.status <> 'ready' then
    raise exception 'Ce match ne peut pas encore être joué : ses joueurs ne sont pas encore connus.';
  end if;

  -- Un joueur ne joue qu'un match à la fois
  select string_agg(public.nom_inscrit(x), ' et ') into occupe
  from public.tournament_entries x
  where x.id in (m.entry_a, m.entry_b)
    and exists (select 1 from public.tournament_matches o
                where o.tournament_id = m.tournament_id and o.status = 'live' and o.id <> m.id
                  and (o.entry_a = x.id or o.entry_b = x.id));
  if occupe is not null then
    raise exception '% a déjà un match en cours. Terminez-le avant de lancer celui-ci.', occupe;
  end if;

  f := case when m.phase = 'pool' then t.pool_format else t.final_format end;
  if f is null then
    raise exception 'Le format des matchs de cette phase n''est pas défini.';
  end if;

  perform set_config('dolina.interne', 'oui', true);
  insert into public.games (created_by, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n,
                            visibility, first_side, show_checkout, tournament_match_id)
  values (auth.uid(), f ->> 'variant', (f ->> 'start_score')::int,
          case when t.team_mode = 'double' then 'double' else 'single' end,
          f ->> 'legs_kind', (f ->> 'legs_n')::int, nullif(f ->> 'sets_kind', ''), nullif(f ->> 'sets_n', '')::int,
          case when t.public_matches then 'public' else 'private' end,
          case when p_premier = 2 then 2 else 1 end, t.show_checkout, m.id)
  returning id into g;

  -- Camp 1 = joueur A du match, camp 2 = joueur B
  for cote in 1..2 loop
    select * into e from public.tournament_entries where id = case when cote = 1 then m.entry_a else m.entry_b end;
    insert into public.game_sides (game_id, side, name) values (g, cote, case when t.team_mode = 'double' then left(e.team_name, 40) end);
    insert into public.game_players (game_id, side, profile_id, guest_name, throw_order)
    values (g, cote, e.profile_id, case when e.profile_id is null then coalesce(e.guest_name, 'Ancien joueur') end, 1);
    if t.team_mode = 'double' then
      insert into public.game_players (game_id, side, profile_id, guest_name, throw_order)
      values (g, cote, e.partner_profile_id, case when e.partner_profile_id is null then coalesce(e.partner_guest_name, 'Ancien joueur') end, 2);
    end if;
  end loop;

  update public.tournament_matches set status = 'live', game_id = g where id = m.id;
  perform set_config('dolina.interne', '', true);
  return g;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. VALIDER LE RÉSULTAT
--    Par la personne qui a tenu le score, l'organisateur ou un admin,
--    une fois la partie terminée dans le scorer.
-- ---------------------------------------------------------------------

-- Fin de tournoi : tous les matchs de l'arbre sont joués
create or replace function public.verifier_fin_tournoi(p_tournoi uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final')
     and not exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final' and status not in ('done', 'bye')) then
    perform set_config('dolina.interne', 'oui', true);
    update public.tournaments set status = 'finished', finished_at = now() where id = p_tournoi and status = 'running';
  end if;
end;
$$;

create or replace function public.valider_match_tournoi(p_game uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games;
  m public.tournament_matches;
  sa int; sb int; la int; lb int;
begin
  select * into g from public.games where id = p_game;
  if not found or g.tournament_match_id is null then
    raise exception 'Cette partie n''est pas un match de tournoi.';
  end if;
  select * into m from public.tournament_matches where id = g.tournament_match_id for update;
  if not (g.created_by = auth.uid() or public.tournoi_organisateur(m.tournament_id)) or not public.is_active_member() then
    raise exception 'Seuls la personne qui a tenu le score et l''organisateur peuvent valider ce résultat.';
  end if;
  if m.status = 'done' then
    return;                                  -- déjà validé (double clic, deux appareils…) : rien à refaire
  end if;
  if m.status <> 'live' or m.game_id is distinct from g.id then
    raise exception 'Ce match n''attend pas de validation.';
  end if;
  if g.status <> 'finished' or g.winner_side is null then
    raise exception 'La partie n''est pas terminée : terminez-la dans le scorer avant de valider.';
  end if;

  -- Manches gagnées par camp, et sets (le vainqueur d'un set est l'auteur de son dernier finish)
  select count(*) filter (where side = 1), count(*) filter (where side = 2) into la, lb
  from public.visits where game_id = g.id and is_checkout;
  if g.sets_n is not null then
    select count(*) filter (where side = 1), count(*) filter (where side = 2) into sa, sb
    from (select distinct on (set_no) set_no, side from public.visits
          where game_id = g.id and is_checkout order by set_no, id desc) d;
  else
    sa := la; sb := lb;
  end if;

  update public.tournament_matches set
    status = 'done',
    winner_entry = case when g.winner_side = 1 then entry_a else entry_b end,
    score_a = sa, score_b = sb, legs_a = la, legs_b = lb, forfeit = false,
    validated_at = now(), validated_by = auth.uid()
  where id = m.id;

  perform public.faire_avancer(m.id);
  perform public.verifier_fin_tournoi(m.tournament_id);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. VERROUS ET SYNCHRONISATION AVEC LE SCORER
-- ---------------------------------------------------------------------

-- Une partie dont le résultat est validé ne se modifie plus (volées, statut)
create or replace function public.verrou_partie_tournoi()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  idg uuid := coalesce(new.game_id, old.game_id);
begin
  if coalesce(current_setting('dolina.interne', true), '') = 'oui' then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.games g join public.tournament_matches m on m.id = g.tournament_match_id
             where g.id = idg and m.status = 'done') then
    raise exception 'Résultat validé pour le tournoi : la partie ne peut plus être modifiée. Contactez l''organisateur en cas d''erreur.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists visites_verrou_tournoi on public.visits;
create trigger visites_verrou_tournoi before insert or update or delete on public.visits
  for each row execute function public.verrou_partie_tournoi();

create or replace function public.verrou_statut_partie_tournoi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('dolina.interne', true), '') = 'oui' then
    return new;
  end if;
  if old.tournament_match_id is not null then
    if new.status is distinct from 'abandoned' then
      new.tournament_match_id := old.tournament_match_id;   -- le lien ne se change pas depuis le site
    end if;
    if (new.status is distinct from old.status or new.winner_side is distinct from old.winner_side)
       and exists (select 1 from public.tournament_matches m where m.id = old.tournament_match_id and m.status = 'done') then
      raise exception 'Résultat validé pour le tournoi : la partie ne peut plus être modifiée. Contactez l''organisateur en cas d''erreur.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists parties_verrou_tournoi on public.games;
create trigger parties_verrou_tournoi before update on public.games
  for each row execute function public.verrou_statut_partie_tournoi();

-- Partie abandonnée ou supprimée : le match redevient « à jouer »
create or replace function public.partie_tournoi_retiree()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.tournament_match_id is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' or new.status = 'abandoned' then
    update public.tournament_matches set status = 'ready', game_id = null
     where id = old.tournament_match_id and status = 'live';
    if tg_op = 'UPDATE' then
      new.tournament_match_id := null;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists parties_tournoi_suppression on public.games;
create trigger parties_tournoi_suppression before delete on public.games
  for each row execute function public.partie_tournoi_retiree();
drop trigger if exists parties_tournoi_abandon on public.games;
create trigger parties_tournoi_abandon before update of status on public.games
  for each row when (new.status = 'abandoned') execute function public.partie_tournoi_retiree();

-- Les parties d'un tournoi ne se créent que par lancer_match_tournoi
create or replace function public.lien_tournoi_protege()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tournament_match_id is not null and coalesce(current_setting('dolina.interne', true), '') <> 'oui' then
    raise exception 'Un match de tournoi se lance depuis la page du tournoi.';
  end if;
  return new;
end;
$$;

drop trigger if exists parties_lien_tournoi on public.games;
create trigger parties_lien_tournoi before insert on public.games
  for each row execute function public.lien_tournoi_protege();


-- ---------------------------------------------------------------------
-- 5. PHASE FINALE APRÈS LES POULES (organisateur)
--    Qualifiés : les N premiers de chaque poule. Les premiers de poule
--    sont les mieux placés (exemptions éventuelles) ; au premier tour,
--    deux joueurs d'une même poule ne se rencontrent pas quand c'est
--    possible (1er A contre 2e B, 1er B contre 2e A…).
-- ---------------------------------------------------------------------

create or replace function public.lancer_phase_finale(p_tournoi uuid, p_format jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  f jsonb := public.verifier_format_match(p_format);
  qualif uuid[] := '{}';
  poules int[] := '{}';
  rangs int[] := '{}';
  r int; k int; i int; j int;
  n int; taille int := 2;
  ordre int[];
  sa int; sb int;
  tmp uuid; tmpi int;
  premier_no int;
  ok boolean;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found or not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut lancer la phase finale.';
  end if;
  if t.status <> 'running' or t.format <> 'pools' then
    raise exception 'La phase finale se lance pendant un tournoi avec poules.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final') then
    raise exception 'La phase finale est déjà lancée.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'pool' and status not in ('done', 'bye')) then
    raise exception 'Tous les matchs de poule doivent être terminés avant la phase finale.';
  end if;

  -- Qualifiés, rang par rang : 1ers de chaque poule, puis 2es (ordre inversé), etc.
  for r in 1..t.pool_qualifiers loop
    for k in 1..t.pools_count loop
      i := case when r % 2 = 1 then k else t.pools_count + 1 - k end;
      select c.entry_id into tmp from public.classement_poule(p_tournoi, i) c where c.rang = r;
      if tmp is not null then
        qualif := qualif || tmp; poules := poules || i; rangs := rangs || r;
      end if;
    end loop;
  end loop;
  n := coalesce(array_length(qualif, 1), 0);
  if n < 2 then
    raise exception 'Il faut au moins 2 qualifiés pour la phase finale.';
  end if;

  -- Éviter, au premier tour, deux joueurs de la même poule (échanges entre joueurs de même rang)
  while taille < n loop taille := taille * 2; end loop;
  ordre := public.ordre_arbre(taille);
  for i in 1..taille / 2 loop
    sa := ordre[2 * i - 1]; sb := ordre[2 * i];
    continue when sa > n or sb > n or poules[sa] <> poules[sb];
    ok := false;
    for j in 1..n loop
      continue when j = sb or j = sa or rangs[j] <> rangs[sb];
      -- j prend la place de sb : vérifier que les deux matchs concernés deviennent valides
      declare
        adv_j int; pos int;
      begin
        adv_j := null;
        for pos in 1..taille loop
          if ordre[pos] = j then
            adv_j := case when pos % 2 = 1 then ordre[pos + 1] else ordre[pos - 1] end;
          end if;
        end loop;
        if poules[j] <> poules[sa] and (adv_j is null or adv_j > n or poules[sb] <> poules[adv_j]) then
          tmp := qualif[sb]; qualif[sb] := qualif[j]; qualif[j] := tmp;
          tmpi := poules[sb]; poules[sb] := poules[j]; poules[j] := tmpi;
          ok := true;
        end if;
      end;
      exit when ok;
    end loop;
  end loop;

  select coalesce(max(match_no), 0) + 1 into premier_no from public.tournament_matches where tournament_id = p_tournoi;
  perform set_config('dolina.interne', 'oui', true);
  perform public.creer_arbre(p_tournoi, qualif, premier_no, t.third_place);
  update public.tournaments set final_format = f where id = p_tournoi;
  perform public.verifier_fin_tournoi(p_tournoi);
end;
$$;


-- ---------------------------------------------------------------------
-- 6. FORFAIT ET CORRECTION (organisateur ou admin)
-- ---------------------------------------------------------------------

create or replace function public.forfait_match(p_match uuid, p_forfait uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found or not public.tournoi_organisateur(m.tournament_id) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut déclarer un forfait.';
  end if;
  if m.status not in ('ready', 'live') then
    raise exception 'Un forfait se déclare sur un match à jouer ou en cours.';
  end if;
  if p_forfait is distinct from m.entry_a and p_forfait is distinct from m.entry_b then
    raise exception 'Ce joueur ne fait pas partie du match.';
  end if;
  perform set_config('dolina.interne', 'oui', true);
  if m.game_id is not null then
    delete from public.games where id = m.game_id;          -- partie commencée : elle est effacée
  end if;
  update public.tournament_matches set
    status = 'done', forfeit = true, game_id = null,
    winner_entry = case when p_forfait = entry_a then entry_b else entry_a end,
    score_a = null, score_b = null, legs_a = 0, legs_b = 0,
    validated_at = now(), validated_by = auth.uid()
  where id = m.id;
  perform public.faire_avancer(m.id);
  perform public.verifier_fin_tournoi(m.tournament_id);
end;
$$;

-- Remettre un match « à jouer » (erreur de score) : la partie est effacée.
-- Impossible si la suite du tournoi en dépend déjà (match suivant commencé,
-- ou phase finale lancée pour un match de poule).
create or replace function public.reinitialiser_match(p_match uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  t public.tournaments;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found or not public.tournoi_organisateur(m.tournament_id) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut corriger un résultat.';
  end if;
  select * into t from public.tournaments where id = m.tournament_id for update;
  if m.status not in ('done', 'live') then
    raise exception 'Ce match n''a pas encore été joué.';
  end if;
  if m.phase = 'pool' and exists (select 1 from public.tournament_matches where tournament_id = m.tournament_id and phase = 'final') then
    raise exception 'La phase finale est lancée : les résultats de poule ne peuvent plus être corrigés.';
  end if;
  if exists (select 1 from public.tournament_matches x where x.id in (m.next_match_id, m.loser_match_id) and (x.status in ('live', 'done') or x.game_id is not null)) then
    raise exception 'Le match suivant a déjà commencé : corrigez d''abord celui-ci.';
  end if;

  perform set_config('dolina.interne', 'oui', true);
  if m.game_id is not null then
    delete from public.games where id = m.game_id;
  end if;
  -- Retirer le vainqueur (et le perdant) des matchs suivants
  if m.status = 'done' and m.next_match_id is not null then
    update public.tournament_matches set
      entry_a = case when m.next_slot = 'a' then null else entry_a end,
      entry_b = case when m.next_slot = 'b' then null else entry_b end,
      status = 'waiting'
    where id = m.next_match_id;
  end if;
  if m.status = 'done' and m.loser_match_id is not null then
    update public.tournament_matches set
      entry_a = case when m.loser_slot = 'a' then null else entry_a end,
      entry_b = case when m.loser_slot = 'b' then null else entry_b end,
      status = 'waiting'
    where id = m.loser_match_id;
  end if;
  update public.tournament_matches set
    status = 'ready', game_id = null, winner_entry = null, score_a = null, score_b = null,
    legs_a = null, legs_b = null, forfeit = false, validated_at = null, validated_by = null
  where id = m.id;
  if t.status = 'finished' then
    update public.tournaments set status = 'running', finished_at = null where id = t.id;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. LECTURE : page d'un tournoi (avec l'état des parties liées)
-- ---------------------------------------------------------------------

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
      'third_place', t.third_place, 'public_matches', t.public_matches, 'show_checkout', t.show_checkout, 'status', t.status,
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
        'next_match_id', m.next_match_id, 'next_slot', m.next_slot, 'loser_match_id', m.loser_match_id, 'loser_slot', m.loser_slot,
        'game_status', g.status, 'game_created_by', g.created_by, 'game_winner_side', g.winner_side
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 8. DROITS D'EXÉCUTION
-- ---------------------------------------------------------------------

revoke execute on function public.lancer_match_tournoi(uuid, int) from public, anon;
revoke execute on function public.valider_match_tournoi(uuid) from public, anon;
revoke execute on function public.lancer_phase_finale(uuid, jsonb) from public, anon;
revoke execute on function public.forfait_match(uuid, uuid) from public, anon;
revoke execute on function public.reinitialiser_match(uuid) from public, anon;
revoke execute on function public.verifier_fin_tournoi(uuid) from public, anon, authenticated;
grant execute on function public.lancer_match_tournoi(uuid, int) to authenticated;
grant execute on function public.valider_match_tournoi(uuid) to authenticated;
grant execute on function public.lancer_phase_finale(uuid, jsonb) to authenticated;
grant execute on function public.forfait_match(uuid, uuid) to authenticated;
grant execute on function public.reinitialiser_match(uuid) to authenticated;
grant execute on function public.classement_poule(uuid, int) to authenticated;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
