-- =====================================================================
--  047 – Fil du club (membres connectés)
--  Annonces automatiques à chaque match terminé, une carte par joueur
--  et par match quand il a réalisé au moins un de ces exploits :
--    - un finish de 100 ou plus,
--    - un 180,
--    - une volée de 120 ou plus,
--    - une moyenne (3 fléchettes) de 60 ou plus sur le match,
--    - un record : record personnel ou record du club (moyenne d'un
--      match, finish).
--  Rien n'est enregistré : le fil est calculé à partir des parties.
--  Exclus : parties contre le dartbot, matchs amicaux, parties seul,
--  doubles (2 contre 2).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 046.
--  Peut être relancé sans risque.
-- =====================================================================

drop function if exists public.fil_du_club(timestamptz, int);
create or replace function public.fil_du_club(p_decalage int default 0, p_limite int default 20)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  res json;
begin
  if not public.is_active_member() then
    raise exception 'Le fil du club est réservé aux membres.';
  end if;
  with parties as (
    select g.id, g.variant, g.start_score, g.winner_side, g.tournament_match_id, g.match_type,
           coalesce(g.finished_at, g.updated_at) as fin
    from public.games g
    where g.status = 'finished' and g.mode = 'single' and g.match_type <> 'amical'
      and (select count(*) from public.game_sides s where s.game_id = g.id) = 2
  ),
  joueurs as (
    select p.*, gp.side, gp.profile_id,
           (select gp2.display_name from public.game_players gp2 where gp2.game_id = p.id and gp2.side <> gp.side limit 1) as adversaire
    from parties p
    join public.game_players gp on gp.game_id = p.id and gp.profile_id is not null
    join public.profiles pr on pr.id = gp.profile_id and pr.status = 'active'
  ),
  perf as (
    select j.*,
      (select coalesce(sum(case when v.is_bust then 0 else v.score end), 0) from public.visits v where v.game_id = j.id and v.side = j.side) as points,
      (select coalesce(sum(case when v.is_checkout then v.darts_used else 3 end), 0) from public.visits v where v.game_id = j.id and v.side = j.side) as flechettes,
      (select count(*) from public.visits v where v.game_id = j.id and v.side = j.side and not v.is_bust and v.score = 180) as nb_180,
      (select count(*) from public.visits v where v.game_id = j.id and v.side = j.side and not v.is_bust and v.score >= 120 and v.score < 180) as nb_120,
      (select max(v.score) from public.visits v where v.game_id = j.id and v.side = j.side and not v.is_bust) as meilleure_volee,
      (select max(v.remaining_before) from public.visits v where v.game_id = j.id and v.side = j.side and v.is_checkout) as meilleur_finish,
      (select count(*) from public.visits v where v.game_id = j.id and v.side = j.side and v.is_checkout) as manches_pour,
      (select count(*) from public.visits v where v.game_id = j.id and v.side <> j.side and v.is_checkout) as manches_contre
    from joueurs j
  ),
  moy as (
    select p.*, case when p.flechettes > 0 then round(p.points::numeric / p.flechettes * 3, 1) end as moyenne
    from perf p
  ),
  -- Records : comparés à toutes les parties précédentes (du joueur, ou de tout le club)
  rec as (
    select m.*,
      max(m.moyenne) over (partition by m.profile_id order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_moy_perso,
      max(m.meilleur_finish) over (partition by m.profile_id order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_finish_perso,
      max(m.moyenne) over (order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_moy_club,
      max(m.meilleur_finish) over (order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_finish_club
    from moy m
  ),
  annonces as (
    select r.*,
      (r.moyenne is not null and r.prec_moy_club is not null and r.moyenne > r.prec_moy_club) as record_club_moyenne,
      (r.meilleur_finish is not null and r.prec_finish_club is not null and r.meilleur_finish > r.prec_finish_club) as record_club_finish,
      (r.moyenne is not null and r.prec_moy_perso is not null and r.moyenne > r.prec_moy_perso) as record_perso_moyenne,
      (r.meilleur_finish is not null and r.prec_finish_perso is not null and r.meilleur_finish > r.prec_finish_perso) as record_perso_finish
    from rec r
  ),
  retenues as (
    select a.* from annonces a
    where (a.meilleur_finish >= 100 or a.nb_180 > 0 or a.nb_120 > 0 or a.moyenne >= 60
           or a.record_club_moyenne or a.record_club_finish or a.record_perso_moyenne or a.record_perso_finish)
    order by a.fin desc, a.id, a.side
    limit least(greatest(coalesce(p_limite, 20), 1), 50) offset greatest(coalesce(p_decalage, 0), 0)
  )
  select coalesce(json_agg(json_build_object(
    'game_id', r.id, 'fin', r.fin, 'variant', r.variant, 'start_score', r.start_score,
    'tournoi', r.tournament_match_id is not null, 'type', r.match_type,
    'joueur', (select json_build_object('id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name,
                 'nickname', pr.nickname, 'use_nickname', pr.use_nickname, 'photo_path', pr.photo_path)
               from public.profiles pr where pr.id = r.profile_id),
    'adversaire', r.adversaire, 'gagne', r.winner_side = r.side,
    'manches_pour', r.manches_pour, 'manches_contre', r.manches_contre,
    'moyenne', r.moyenne, 'nb_180', r.nb_180, 'nb_120', r.nb_120,
    'meilleure_volee', r.meilleure_volee, 'meilleur_finish', r.meilleur_finish,
    'record_club_moyenne', r.record_club_moyenne, 'record_club_finish', r.record_club_finish,
    'record_perso_moyenne', r.record_perso_moyenne, 'record_perso_finish', r.record_perso_finish
  ) order by r.fin desc, r.id, r.side), '[]'::json) into res
  from retenues r;
  return res;
end;
$$;
revoke execute on function public.fil_du_club(int, int) from public, anon;
grant execute on function public.fil_du_club(int, int) to authenticated;

notify pgrst, 'reload schema';
