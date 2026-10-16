-- =====================================================================
--  032 – Records du club (membres connectés)
--  - Meilleure moyenne sur une partie (au moins 9 fléchettes lancées)
--  - Plus haut finish
--  Mêmes parties que le classement : 301 / 501 terminées, en individuel,
--  contre au moins un adversaire, hors matchs amicaux (le dartbot et le
--  2v2 sont exclus). Membres validés seulement (pas les invités).
--  Un joueur n'apparaît qu'une fois par record (sa meilleure performance).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 031.
-- =====================================================================

create or replace function public.records_club(
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null,
  p_limite int default 10
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Les records sont réservés aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;

  with parties as (
    select gp.profile_id, g.id as game_id, gp.side, g.variant,
           coalesce(g.finished_at, g.updated_at) as quand
    from public.games g
    join public.game_players gp on gp.game_id = g.id and gp.profile_id is not null
    join public.profiles pr on pr.id = gp.profile_id and pr.status = 'active'
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'single' and g.match_type <> 'amical'
      and (select count(*) from public.game_sides s where s.game_id = g.id) >= 2
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
  ),
  -- Moyenne de chaque joueur sur chaque partie
  moyennes as (
    select p.profile_id, p.game_id, p.variant, p.quand,
           sum(case when v.is_bust then 0 else v.score end) as points,
           sum(case when v.is_checkout then v.darts_used else 3 end) as flechettes
    from parties p join public.visits v on v.game_id = p.game_id and v.side = p.side
    group by p.profile_id, p.game_id, p.variant, p.quand
  ),
  meilleures_moyennes as (
    select distinct on (profile_id) profile_id, game_id, variant, quand, flechettes,
           round(points::numeric * 3 / flechettes, 2) as moyenne
    from moyennes where flechettes >= 9
    order by profile_id, points::numeric / flechettes desc, quand
  ),
  meilleurs_finishs as (
    select distinct on (p.profile_id) p.profile_id, p.game_id, p.variant, p.quand,
           v.remaining_before as finish, v.darts_used as flechettes
    from parties p join public.visits v on v.game_id = p.game_id and v.side = p.side and v.is_checkout
    order by p.profile_id, v.remaining_before desc, p.quand
  ),
  -- Adversaires d'une partie (noms affichés, autres camps)
  adv as (
    select p.profile_id, p.game_id,
           string_agg(gp.display_name, ', ' order by gp.side, gp.throw_order) as adversaires
    from parties p join public.game_players gp on gp.game_id = p.game_id and gp.side <> p.side
    group by p.profile_id, p.game_id
  )
  select json_build_object(
    'moyennes', coalesce((
      select json_agg(x order by x.moyenne desc, x.quand) from (
        select m.profile_id, m.game_id, m.variant, m.quand, m.flechettes, m.moyenne,
               pr.first_name, pr.last_name, pr.nickname, pr.use_nickname, pr.photo_path,
               public.nom_affiche(pr) as nom, a.adversaires
        from meilleures_moyennes m
        join public.profiles pr on pr.id = m.profile_id
        left join adv a on a.profile_id = m.profile_id and a.game_id = m.game_id
        order by m.moyenne desc, m.quand
        limit greatest(1, least(p_limite, 50))
      ) x), '[]'::json),
    'finishs', coalesce((
      select json_agg(x order by x.finish desc, x.quand) from (
        select f.profile_id, f.game_id, f.variant, f.quand, f.flechettes, f.finish,
               pr.first_name, pr.last_name, pr.nickname, pr.use_nickname, pr.photo_path,
               public.nom_affiche(pr) as nom, a.adversaires
        from meilleurs_finishs f
        join public.profiles pr on pr.id = f.profile_id
        left join adv a on a.profile_id = f.profile_id and a.game_id = f.game_id
        order by f.finish desc, f.quand
        limit greatest(1, least(p_limite, 50))
      ) x), '[]'::json)
  ) into resultat;
  return resultat;
end;
$$;

revoke execute on function public.records_club(timestamptz, timestamptz, text, int) from public, anon;
grant execute on function public.records_club(timestamptz, timestamptz, text, int) to authenticated;
