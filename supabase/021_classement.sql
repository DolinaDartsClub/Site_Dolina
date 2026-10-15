-- =====================================================================
--  Étape 6b : classement des membres et classement des doublettes
--  À exécuter une fois dans Supabase (après 019) : SQL Editor > New query > Run
--
--  Mêmes règles que « Mes stats » (parties terminées en 301 et 501,
--  invités et matchs de tournoi compris, abandons et score libre exclus).
--  Ordre du classement (décision du 15/10/2026) :
--    1. matchs gagnés  2. manches gagnées  3. réussite au double  4. moyenne
--  Seuil : un nombre minimum de manches jouées sur la période pour être
--  classé (réglage « ranking_min_legs », 5 par défaut, modifiable par l'admin).
--  Réservé aux membres validés.
-- =====================================================================

-- Classement individuel (parties en individuel)
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
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'single'
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

-- Classement des doublettes (parties en 2 contre 2) : une doublette = les deux
-- mêmes joueurs (membres ou invités), quel que soit l'ordre de jeu.
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
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'double'
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

revoke execute on function public.classement_membres(timestamptz, timestamptz, text, uuid) from public, anon;
revoke execute on function public.classement_doublettes(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.classement_membres(timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.classement_doublettes(timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
