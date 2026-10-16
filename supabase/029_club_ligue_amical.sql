-- =====================================================================
--  Club, ligue ou amical
--  À exécuter une fois dans Supabase (après 028) : SQL Editor > New query > Run
--
--  Chaque partie (et chaque tournoi) a un type :
--    club   : partie jouée au club (par défaut, comme avant) — compte au classement
--    ligue  : match de ligue (au club ou à l'extérieur)        — compte au classement
--    amical : match amical à l'extérieur                       — compte seulement dans
--             les stats du joueur (Mes stats, face-à-face), PAS au classement
--  Les matchs d'un tournoi prennent le type du tournoi.
--  Une fois la partie terminée, son type ne change plus (sauf par un admin).
-- =====================================================================

alter table public.games add column if not exists match_type text not null default 'club'
  check (match_type in ('club', 'ligue', 'amical'));
alter table public.tournaments add column if not exists match_type text not null default 'club'
  check (match_type in ('club', 'ligue', 'amical'));

-- Les matchs d'un tournoi prennent le type du tournoi
create or replace function public.type_partie_tournoi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tournament_match_id is not null then
    select t.match_type into new.match_type
    from public.tournament_matches m join public.tournaments t on t.id = m.tournament_id
    where m.id = new.tournament_match_id;
    new.match_type := coalesce(new.match_type, 'club');
  end if;
  return new;
end;
$$;

drop trigger if exists parties_type_tournoi on public.games;
create trigger parties_type_tournoi before insert on public.games
  for each row execute function public.type_partie_tournoi();

-- Type figé une fois la partie terminée (sauf admin) ; un match de tournoi garde le type du tournoi
create or replace function public.type_partie_fige()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.match_type is distinct from old.match_type
     and current_user in ('anon', 'authenticated')
     and coalesce(current_setting('dolina.interne', true), '') <> 'oui'
     and not public.is_admin()
     and (old.status = 'finished' or old.tournament_match_id is not null) then
    new.match_type := old.match_type;
  end if;
  return new;
end;
$$;

drop trigger if exists parties_type_fige on public.games;
create trigger parties_type_fige before update of match_type on public.games
  for each row execute function public.type_partie_fige();

-- Classements : les matchs amicaux ne comptent pas
create or replace function public.classement_membres(
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null,
  p_equipe uuid default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  seuil int;
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Le classement est réservé aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;
  select coalesce((value #>> '{}')::int, 5) into seuil from public.settings where key = 'ranking_min_legs';
  seuil := coalesce(seuil, 5);

  with parties as (
    select gp.profile_id, g.id as game_id, gp.side, g.winner_side,
           (select count(*) from public.game_sides s where s.game_id = g.id) as nb_camps
    from public.games g
    join public.game_players gp on gp.game_id = g.id and gp.profile_id is not null
    join public.profiles pr on pr.id = gp.profile_id and pr.status = 'active'
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'single' and g.match_type <> 'amical'
      and (select count(*) from public.game_sides s2 where s2.game_id = g.id) >= 2   -- pas de partie seul
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
      and (p_equipe is null or exists (select 1 from public.team_members tm
                                       where tm.profile_id = gp.profile_id and tm.team_id = p_equipe and tm.status = 'accepted'))
  ),
  volees as (
    select p.profile_id, v.game_id, v.set_no, v.leg_no, v.visit_no, v.is_checkout, v.is_bust, v.score,
           v.remaining_before, v.darts_at_double,
           case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as fl
    from parties p join public.visits v on v.game_id = p.game_id and v.side = p.side
  ),
  finishs as (
    select p.profile_id, v.side = p.side as par_moi
    from parties p join public.visits v on v.game_id = p.game_id and v.is_checkout
  ),
  stats as (
    select pr.id as profile_id,
      (select count(*) from parties x where x.profile_id = pr.id and x.nb_camps >= 2) as matchs,
      (select count(*) from parties x where x.profile_id = pr.id and x.nb_camps >= 2 and x.winner_side = x.side) as victoires,
      (select count(*) from finishs f where f.profile_id = pr.id and f.par_moi) as manches_gagnees,
      (select count(*) from finishs f where f.profile_id = pr.id and not f.par_moi) as manches_perdues,
      (select count(*) from (select distinct game_id, set_no, leg_no from volees v where v.profile_id = pr.id) d) as manches_jouees,
      (select coalesce(sum(points), 0) from volees v where v.profile_id = pr.id) as points,
      (select coalesce(sum(fl), 0) from volees v where v.profile_id = pr.id) as flechettes,
      (select coalesce(sum(points), 0) from volees v where v.profile_id = pr.id and v.visit_no <= 3) as points_9,
      (select coalesce(sum(fl), 0) from volees v where v.profile_id = pr.id and v.visit_no <= 3) as flechettes_9,
      (select count(*) from volees v where v.profile_id = pr.id and v.is_checkout) as finishs,
      (select coalesce(sum(darts_at_double), 0) from volees v where v.profile_id = pr.id) as flechettes_double,
      (select max(remaining_before) from volees v where v.profile_id = pr.id and v.is_checkout) as meilleur_finish,
      (select count(*) from volees v where v.profile_id = pr.id and not v.is_bust and v.score = 180) as nb_180
    from public.profiles pr
    where pr.id in (select distinct profile_id from parties)
  )
  select json_build_object(
    'seuil', seuil,
    'joueurs', coalesce(json_agg(json_build_object(
      'profile_id', s.profile_id,
      'nom', (select public.nom_affiche(pr) from public.profiles pr where pr.id = s.profile_id),
      'equipes', (select string_agg(t.name, ', ' order by t.sort_order) from public.team_members tm join public.teams t on t.id = tm.team_id
                  where tm.profile_id = s.profile_id and tm.status = 'accepted'),
      'matchs', s.matchs, 'victoires', s.victoires,
      'manches_gagnees', s.manches_gagnees, 'manches_perdues', s.manches_perdues, 'manches_jouees', s.manches_jouees,
      'points', s.points, 'flechettes', s.flechettes, 'points_9', s.points_9, 'flechettes_9', s.flechettes_9,
      'finishs', s.finishs, 'flechettes_double', s.flechettes_double,
      'meilleur_finish', s.meilleur_finish, 'nb_180', s.nb_180,
      'classe', s.manches_jouees >= seuil
    ) order by s.victoires desc, s.manches_gagnees desc,
               (s.finishs::numeric / nullif(s.flechettes_double, 0)) desc nulls last,
               (s.points::numeric / nullif(s.flechettes, 0)) desc nulls last), '[]'::json)
  ) into resultat
  from stats s;
  return resultat;
end;
$$;

create or replace function public.classement_doublettes(
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  seuil int;
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Le classement est réservé aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;
  select coalesce((value #>> '{}')::int, 5) into seuil from public.settings where key = 'ranking_min_legs';
  seuil := coalesce(seuil, 5);

  with camps as (
    select g.id as game_id, s.side, g.winner_side,
           (select count(*) from public.game_sides x where x.game_id = g.id) as nb_camps,
           (select string_agg(coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)), '|' order by coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)))
              from public.game_players gp where gp.game_id = g.id and gp.side = s.side) as cle,
           (select string_agg(gp.display_name, ' & ' order by coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)))
              from public.game_players gp where gp.game_id = g.id and gp.side = s.side) as noms,
           (select array_agg(gp.profile_id) filter (where gp.profile_id is not null)
              from public.game_players gp where gp.game_id = g.id and gp.side = s.side) as membres
    from public.games g join public.game_sides s on s.game_id = g.id
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'double' and g.match_type <> 'amical'
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
  ),
  -- une vraie doublette (2 joueurs) avec au moins un membre du club
  paires as (select * from camps where array_length(membres, 1) >= 1 and array_length(string_to_array(cle, '|'), 1) = 2),
  volees as (
    select p.cle, v.*, case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as fl
    from paires p join public.visits v on v.game_id = p.game_id and v.side = p.side
  ),
  finishs as (
    select p.cle, v.side = p.side as par_nous
    from paires p join public.visits v on v.game_id = p.game_id and v.is_checkout
  ),
  stats as (
    select p.cle, max(p.noms) as noms,
      count(*) filter (where p.nb_camps >= 2) as matchs,
      count(*) filter (where p.nb_camps >= 2 and p.winner_side = p.side) as victoires
    from paires p group by p.cle
  )
  select json_build_object(
    'seuil', seuil,
    'doublettes', coalesce(json_agg(json_build_object(
      'cle', s.cle, 'noms', s.noms, 'matchs', s.matchs, 'victoires', s.victoires,
      'manches_gagnees', (select count(*) from finishs f where f.cle = s.cle and f.par_nous),
      'manches_perdues', (select count(*) from finishs f where f.cle = s.cle and not f.par_nous),
      'manches_jouees', (select count(*) from (select distinct game_id, set_no, leg_no from volees v where v.cle = s.cle) d),
      'points', (select coalesce(sum(points), 0) from volees v where v.cle = s.cle),
      'flechettes', (select coalesce(sum(fl), 0) from volees v where v.cle = s.cle),
      'finishs', (select count(*) from volees v where v.cle = s.cle and v.is_checkout),
      'flechettes_double', (select coalesce(sum(darts_at_double), 0) from volees v where v.cle = s.cle),
      'meilleur_finish', (select max(remaining_before) from volees v where v.cle = s.cle and v.is_checkout),
      'nb_180', (select count(*) from volees v where v.cle = s.cle and not v.is_bust and v.score = 180)
    )), '[]'::json)
  ) into resultat
  from stats s;
  return resultat;
end;
$$;

notify pgrst, 'reload schema';
