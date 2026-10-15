-- =====================================================================
--  Étape 6a : statistiques d'un joueur (« Mes stats »)
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--
--  Règles (cahier des charges § 7, décisions du 15/10/2026) :
--  - seules les parties TERMINÉES en 301 et 501 comptent (ni score libre,
--    ni parties abandonnées) ; matchs de tournoi compris
--  - parties en individuel (1 contre 1, ou jusqu'à 4 joueurs) ; les
--    doublettes ont leurs propres stats (onglet Doublettes, étape 6b)
--  - les parties contre un invité comptent (moyennes ET bilan)
--  - à 3 ou 4 joueurs : le gagnant compte une victoire, les autres une défaite
--  - une partie seul compte pour les moyennes, pas pour le bilan
--  - moyenne 3 fléchettes = points ÷ fléchettes × 3 (une volée en bust
--    compte 3 fléchettes et 0 point) ; 9 premières = 3 premières volées
--    de chaque manche ; réussite au double = finishs ÷ fléchettes au double
--  Visible par les membres validés uniquement (pas par les visiteurs).
-- =====================================================================

create index if not exists game_players_profil_partie on public.game_players (profile_id, game_id);

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

revoke execute on function public.stats_joueur(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.stats_joueur(uuid, timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
