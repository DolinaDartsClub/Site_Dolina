-- =====================================================================
--  077 – Ligue interne : matchs en pause, classement, ordre des tournois
--  1. Ordre : les tournois en cours en haut, puis la ligue interne, puis
--     les autres (accueil ; les pages Tournois et Admin trient pareil).
--  2. Ligue : un match commencé mais pas fini peut être repris plus tard
--     (par l'un ou l'autre joueur), et ses joueurs peuvent lancer d'autres
--     matchs en attendant. Un match en pause (rien saisi depuis 45 min)
--     n'occupe plus la cible de la poule. Il reste non validé tant qu'il
--     n'a pas de vainqueur.
--  3. Classement de poule : points, puis différence de manches, puis
--     manches gagnées, puis matchs joués (le plus passe devant), puis le
--     match entre eux.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 076.
--  Peut être relancé sans risque.
-- =====================================================================

-- Partie active : une volée saisie (ou la partie lancée) il y a moins de 45 min
create or replace function public.partie_active(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(greatest(
    (select max(v.created_at) from public.visits v where v.game_id = p_game),
    (select g.created_at from public.games g where g.id = p_game)
  ) > now() - interval '45 minutes', false);
$$;

-- Reprendre le scorer d'un match de tournoi en cours (l'un des joueurs ou l'organisateur)
create or replace function public.reprendre_partie_tournoi(p_game uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games;
  m public.tournament_matches;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.tournament_match_id is null then raise exception 'Partie introuvable.'; end if;
  select * into m from public.tournament_matches where id = g.tournament_match_id;
  if m.status <> 'live' then raise exception 'Ce match n''est plus en cours.'; end if;
  if not public.is_active_member() or not (public.tournoi_organisateur(m.tournament_id)
     or exists (select 1 from public.tournament_entries e where e.id in (m.entry_a, m.entry_b)
                and auth.uid() in (e.profile_id, e.partner_profile_id))) then
    raise exception 'Seuls les joueurs du match et l''organisateur peuvent reprendre le scorer.';
  end if;
  if g.created_by is distinct from auth.uid() then
    perform set_config('dolina.interne', 'oui', true);
    update public.games set created_by = auth.uid() where id = p_game;
    perform set_config('dolina.interne', '', true);
  end if;
  return p_game;
end;
$$;

-- Classement d'une poule
create or replace function public.classement_poule(p_tournoi uuid, p_poule int)
returns table (entry_id uuid, rang int, points int, manches int, victoires int, joues int)
language sql stable security definer set search_path = public as $$
  with joueurs as (
    select e.id, e.seed from public.tournament_entries e where e.tournament_id = p_tournoi and e.pool_no = p_poule
  ), res as (
    select m.*, case when m.winner_entry = m.entry_a then m.entry_b else m.entry_a end as perdant
    from public.tournament_matches m
    where m.tournament_id = p_tournoi and m.phase = 'pool' and m.pool_no = p_poule and m.status = 'done'
      and (m.winner_entry is not null or m.nul)
  ), stats as (
    select j.id, j.seed,
      coalesce(sum(case when r.nul then 1 when r.winner_entry = j.id then 3 when r.forfeit then 0 else 1 end) filter (where r.id is not null), 0)::int as points,
      coalesce(sum(case when r.entry_a = j.id then coalesce(r.legs_a, r.score_a, 0) else coalesce(r.legs_b, r.score_b, 0) end) filter (where r.id is not null and not r.nul), 0)::int as manches,
      coalesce(sum(case when r.entry_a = j.id then coalesce(r.legs_b, r.score_b, 0) else coalesce(r.legs_a, r.score_a, 0) end) filter (where r.id is not null and not r.nul), 0)::int as contre,
      count(*) filter (where r.winner_entry = j.id)::int as victoires,
      count(r.id)::int as joues
    from joueurs j left join res r on r.entry_a = j.id or r.entry_b = j.id
    group by j.id, j.seed
  ), entre as (
    -- Égalité parfaite (points, différence, manches gagnées, matchs joués) : match entre eux
    select s.id, count(r.id)::int as h2h
    from stats s
    left join res r on r.winner_entry = s.id
      and exists (select 1 from stats o where o.id = r.perdant and o.points = s.points and o.manches - o.contre = s.manches - s.contre
                  and o.manches = s.manches and o.joues = s.joues)
    group by s.id
  )
  -- 077 : points, puis différence de manches, puis manches gagnées, puis matchs joués (le plus), puis match entre eux
  select s.id, (row_number() over (order by s.points desc, s.manches - s.contre desc, s.manches desc, s.joues desc, e.h2h desc, s.seed))::int,
         s.points, s.manches, s.victoires, s.joues
  from stats s join entre e on e.id = s.id
  order by 2;
$$;

-- Lancement d'un match (ligue : pas de blocage par un match en pause)
create or replace function public.lancer_match_tournoi(p_match uuid, p_premier int default 1, p_distance boolean default false)
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
  n_live int;
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
  -- 071 : match à distance (caméra), pour la ligue, entre deux joueurs qui ont un compte
  p_distance := coalesce(p_distance, false);
  if p_distance then
    if not t.est_ligue then
      raise exception 'Le match à distance est réservé à la ligue.';
    end if;
    if t.team_mode = 'double' then
      raise exception 'Le match à distance se joue en individuel.';
    end if;
    if exists (select 1 from public.tournament_entries x where x.id in (m.entry_a, m.entry_b) and x.profile_id is null) then
      raise exception 'Pour jouer à distance, les deux joueurs doivent avoir un compte sur le site.';
    end if;
    if not public.tournoi_organisateur(t.id)
       and not exists (select 1 from public.tournament_entries x where x.id in (m.entry_a, m.entry_b) and x.profile_id = auth.uid()) then
      raise exception 'Seuls les deux joueurs du match peuvent le lancer à distance.';
    end if;
  end if;
  if m.status = 'live' then
    raise exception 'Ce match est déjà en cours : suivez-le en direct depuis le tournoi.';
  elsif m.status = 'done' then
    raise exception 'Ce match est déjà terminé.';
  elsif m.status <> 'ready' then
    raise exception 'Ce match ne peut pas encore être joué : ses joueurs ne sont pas encore connus.';
  end if;

  -- Chaque poule joue sur ses cibles : autant de matchs en même temps que de cibles
  if m.phase = 'pool' and not p_distance then
    select string_agg('M' || o.match_no, ', '), count(*) into occupe, n_live
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'pool' and o.pool_no = m.pool_no
      and o.status = 'live' and o.id <> m.id
      and not exists (select 1 from public.games gd where gd.id = o.game_id and gd.a_distance)
      -- 077 : en ligue, un match en pause (rien saisi depuis 45 min) ne bloque pas la cible
      and (not t.est_ligue or public.partie_active(o.game_id));
    if n_live >= coalesce(t.cibles_par_poule, 1) then
      raise exception '% de la poule % occupée% (% en cours). Augmentez le nombre de cibles par poule pour lancer un match de plus.',
        case when coalesce(t.cibles_par_poule, 1) > 1 then 'Les ' || t.cibles_par_poule || ' cibles' else 'La cible' end,
        chr(64 + m.pool_no), case when coalesce(t.cibles_par_poule, 1) > 1 then 's' else '' end, occupe;
    end if;
    occupe := null;
  end if;

  -- Phase finale : autant de matchs en même temps que de cibles (sans limite si non réglé)
  if m.phase = 'final' and t.cibles_finale is not null and not p_distance then
    select string_agg('M' || o.match_no, ', '), count(*) into occupe, n_live
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'final' and o.status = 'live' and o.id <> m.id
      and not exists (select 1 from public.games gd where gd.id = o.game_id and gd.a_distance);
    if n_live >= t.cibles_finale then
      raise exception '% de la phase finale occupée% (% en cours). Augmentez le nombre de cibles de la phase finale pour lancer un match de plus.',
        case when t.cibles_finale > 1 then 'Les ' || t.cibles_finale || ' cibles' else 'La cible' end,
        case when t.cibles_finale > 1 then 's' else '' end, occupe;
    end if;
    occupe := null;
  end if;

  -- Un joueur ne joue qu'un match à la fois
  -- (077 : sauf en ligue, où un match pas fini peut attendre pendant qu'on en joue d'autres)
  select string_agg(public.nom_inscrit(x), ' et ') into occupe
  from public.tournament_entries x
  where x.id in (m.entry_a, m.entry_b)
    and exists (select 1 from public.tournament_matches o
                where o.tournament_id = m.tournament_id and o.status = 'live' and o.id <> m.id
                  and (o.entry_a = x.id or o.entry_b = x.id))
    and not t.est_ligue;
  if occupe is not null then
    raise exception '% % déjà un match en cours. Terminez-le avant de lancer celui-ci.', occupe,
      case when position(' et ' in occupe) > 0 then 'ont' else 'a' end;
  end if;

  f := coalesce(m.format, case when m.phase = 'pool' then t.pool_format else t.final_format end);
  if f is null then
    raise exception 'Le format des matchs de cette phase n''est pas défini.';
  end if;

  perform set_config('dolina.interne', 'oui', true);
  insert into public.games (created_by, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n,
                            visibility, first_side, show_checkout, tournament_match_id, prolongation, a_distance)
  values (auth.uid(), f ->> 'variant', (f ->> 'start_score')::int,
          case when t.team_mode = 'double' then 'double' else 'single' end,
          f ->> 'legs_kind', (f ->> 'legs_n')::int, nullif(f ->> 'sets_kind', ''), nullif(f ->> 'sets_n', '')::int,
          case when t.public_matches then 'public' else 'private' end,
          case when p_premier = 2 then 2 else 1 end, t.show_checkout, m.id,
          f ->> 'legs_kind' = 'first_to' and coalesce((f ->> 'prolongation')::boolean, false), p_distance)
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

-- Tournois en cours (accueil)
create or replace function public.tournois_en_cours()
returns table (
  id uuid, name text, status text, format text, team_mode text, public_matches boolean,
  inscrits int, max_participants int, matchs_total int, matchs_joues int, matchs_en_cours int,
  phase text, tour int, tours int, started_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.status, t.format, t.team_mode, t.public_matches,
    (select count(*)::int from public.tournament_entries e where e.tournament_id = t.id),
    t.max_participants,
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status <> 'bye'),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status = 'done'),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status = 'live'),
    case when t.status = 'open' then 'inscriptions'
         when exists (select 1 from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final') then 'final'
         else 'pool' end,
    (select min(m.round_no)::int from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final' and m.status in ('ready', 'live', 'waiting') and not m.is_third_place),
    (select max(m.round_no)::int from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final'),
    t.started_at
  from public.tournaments t
  where t.status in ('running', 'open')
    and not (t.est_ligue and not t.ligue_visible)
  -- 077 : tournois en cours d'abord, puis la ligue interne, puis les inscriptions ouvertes
  order by (t.status = 'running' and not t.est_ligue) desc, t.est_ligue desc, (t.status = 'running') desc, coalesce(t.started_at, t.created_at) desc
  limit 12;
$$;

-- Derniers tournois du club (page Tournois) : même ordre
create or replace function public.derniers_tournois(p_decalage int default 0, p_limite int default 6)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.poids, x.quand desc), '[]'::json)
  from (
    select t.id, t.name, t.format, t.team_mode, t.status, t.pool_qualifiers, t.est_ligue,
           t.started_at, t.finished_at, coalesce(t.finished_at, t.started_at) as quand,
           case when t.status = 'running' and not t.est_ligue then 0 when t.est_ligue then 1 when t.status = 'running' then 0 else 3 end as poids,
           (select count(*) from public.tournament_entries e where e.tournament_id = t.id) as inscrits,
           (select count(*) from public.tournament_matches m where m.tournament_id = t.id and m.status = 'done') as matchs_joues,
           (select count(*) from public.tournament_matches m where m.tournament_id = t.id and m.status <> 'bye') as matchs_total,
           case when t.status <> 'finished' then null
                when t.sans_phase_finale then
                  (select public.nom_inscrit(e) from public.classement_poule(t.id, 1) c join public.tournament_entries e on e.id = c.entry_id where c.rang = 1)
                else
                  (select public.nom_inscrit(e) from public.tournament_matches m join public.tournament_entries e on e.id = m.winner_entry
                   where m.tournament_id = t.id and m.phase = 'final' and not m.is_third_place and not m.tableau_b and m.next_match_id is null limit 1)
           end as vainqueur,
           (select pt.name from public.tournaments pt where pt.id = t.parent_id) as parent_nom
    from public.tournaments t
    where t.status in ('running', 'finished') and t.public_matches
      and not (t.est_ligue and not t.ligue_visible)
    order by case when t.status = 'running' and not t.est_ligue then 0 when t.est_ligue then 1 when t.status = 'running' then 0 else 3 end,
             coalesce(t.finished_at, t.started_at) desc nulls last
    limit least(greatest(coalesce(p_limite, 6), 1), 30) offset greatest(coalesce(p_decalage, 0), 0)
  ) x
  where public.is_active_member();
$$;

grant execute on function public.partie_active(uuid) to authenticated;
grant execute on function public.reprendre_partie_tournoi(uuid) to authenticated;
notify pgrst, 'reload schema';
