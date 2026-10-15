-- =====================================================================
--  Les parties jouées SEUL (sans adversaire) ne comptent plus dans les
--  statistiques ni dans le classement (décision du 15/10/2026).
--  À exécuter une fois dans Supabase (après 019 et 021) : SQL Editor > Run
--  Seules les parties contre au moins un adversaire (membre ou invité) comptent.
-- =====================================================================

create or replace function public.stats_joueur(
  p_profile uuid,
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Les statistiques sont réservées aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;

  with parties as (
    select g.id, g.variant, coalesce(g.finished_at, g.updated_at) as fin, g.winner_side, gp.side,
           (select count(*) from public.game_sides s where s.game_id = g.id) as nb_camps
    from public.games g
    join public.game_players gp on gp.game_id = g.id and gp.profile_id = p_profile
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'single'
      and (select count(*) from public.game_sides s2 where s2.game_id = g.id) >= 2   -- pas de partie seul
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
  ),
  mes_volees as (
    select v.*, p.variant,
           case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as flechettes
    from public.visits v join parties p on p.id = v.game_id and v.side = p.side
  ),
  mes_manches as (
    select game_id, set_no, leg_no, max(variant) as variant, sum(flechettes) as flechettes, bool_or(is_checkout) as gagnee
    from mes_volees group by game_id, set_no, leg_no
  ),
  finishs_partie as (       -- toutes les manches gagnées (par moi ou par un adversaire) dans mes parties
    select v.game_id, v.side = p.side as par_moi
    from public.visits v join parties p on p.id = v.game_id
    where v.is_checkout
  ),
  par_partie as (
    select p.id, p.fin, p.variant,
           sum(mv.points)::numeric as points, sum(mv.flechettes)::numeric as flechettes
    from parties p join mes_volees mv on mv.game_id = p.id
    group by p.id, p.fin, p.variant
  )
  select json_build_object(
    'joueur', (select json_build_object('id', pr.id, 'nom', public.nom_affiche(pr), 'prenom', pr.first_name, 'nom_famille', pr.last_name, 'surnom', pr.nickname)
               from public.profiles pr where pr.id = p_profile),
    'parties', (select count(*) from parties),
    'parties_bilan', (select count(*) from parties where nb_camps >= 2),
    'victoires', (select count(*) from parties where nb_camps >= 2 and winner_side = side),
    'defaites', (select count(*) from parties where nb_camps >= 2 and winner_side is distinct from side),
    'manches_gagnees', (select count(*) from finishs_partie where par_moi),
    'manches_perdues', (select count(*) from finishs_partie where not par_moi),
    'points', (select coalesce(sum(points), 0) from mes_volees),
    'flechettes', (select coalesce(sum(flechettes), 0) from mes_volees),
    'points_9', (select coalesce(sum(points), 0) from mes_volees where visit_no <= 3),
    'flechettes_9', (select coalesce(sum(flechettes), 0) from mes_volees where visit_no <= 3),
    'finishs', (select count(*) from mes_volees where is_checkout),
    'flechettes_double', (select coalesce(sum(darts_at_double), 0) from mes_volees),
    'meilleur_finish', (select max(remaining_before) from mes_volees where is_checkout),
    'meilleure_volee', (select max(score) from mes_volees where not is_bust),
    'nb_100', (select count(*) from mes_volees where not is_bust and score between 100 and 139),
    'nb_140', (select count(*) from mes_volees where not is_bust and score between 140 and 179),
    'nb_180', (select count(*) from mes_volees where not is_bust and score = 180),
    'manche_courte_301', (select min(flechettes) from mes_manches where gagnee and variant = '301'),
    'manche_courte_501', (select min(flechettes) from mes_manches where gagnee and variant = '501'),
    'meilleure_moyenne_partie', (select round(max(points / nullif(flechettes, 0) * 3), 1) from par_partie),
    'evolution', coalesce((
      select json_agg(json_build_object('id', id, 'date', fin, 'variant', variant,
                                        'moyenne', round(points / nullif(flechettes, 0) * 3, 1)) order by fin)
      from (select * from par_partie where flechettes > 0 order by fin desc limit 60) d), '[]'::json)
  ) into resultat;
  return resultat;
end;
$$;

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

notify pgrst, 'reload schema';
