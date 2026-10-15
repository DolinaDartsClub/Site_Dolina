-- =====================================================================
--  Stats d'un tournoi : un tableau par joueur (ou doublette)
--  À exécuter une fois dans Supabase (après 017) : SQL Editor > New query > Run
--
--  Pour chaque inscrit, sur ses matchs du tournoi terminés et joués
--  (les forfaits ne comptent pas comme matchs joués) :
--  matchs joués, victoires, défaites, manches gagnées / perdues
--  (résultats validés, corrections comprises), moyenne 3 fléchettes et
--  réussite au double (calculées sur les volées saisies dans le scorer),
--  nombre de 180 et meilleur finish.
--  Même accès que la page du tournoi (organisateur, inscrits, et
--  spectateurs si les matchs sont publics).
-- =====================================================================

create or replace function public.stats_tournoi(p_tournoi uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  t public.tournaments;
  resultat json;
begin
  select * into t from public.tournaments where id = p_tournoi;
  if not found then
    raise exception 'Ce tournoi n''existe pas.';
  end if;
  if not (public.tournoi_organisateur(p_tournoi) or public.tournoi_participant(p_tournoi)
          or (t.status in ('running', 'finished') and t.public_matches)) then
    raise exception 'Ce tournoi est réservé à ses participants.';
  end if;

  with joues as (       -- un match vu par chacun de ses deux inscrits
    select m.id, m.game_id, m.entry_a as entry, 1 as cote, m.winner_entry = m.entry_a as gagne,
           coalesce(m.legs_a, m.score_a, 0) as mg, coalesce(m.legs_b, m.score_b, 0) as mp
    from public.tournament_matches m
    where m.tournament_id = p_tournoi and m.status = 'done' and not m.forfeit and m.entry_a is not null and m.entry_b is not null
    union all
    select m.id, m.game_id, m.entry_b, 2, m.winner_entry = m.entry_b,
           coalesce(m.legs_b, m.score_b, 0), coalesce(m.legs_a, m.score_a, 0)
    from public.tournament_matches m
    where m.tournament_id = p_tournoi and m.status = 'done' and not m.forfeit and m.entry_a is not null and m.entry_b is not null
  ),
  volees as (
    select j.entry, v.*,
           case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as fl
    from joues j join public.visits v on v.game_id = j.game_id and v.side = j.cote
  )
  select coalesce(json_agg(json_build_object(
    'entry_id', e.id,
    'matchs', (select count(*) from joues j where j.entry = e.id),
    'victoires', (select count(*) from joues j where j.entry = e.id and j.gagne),
    'defaites', (select count(*) from joues j where j.entry = e.id and not j.gagne),
    'manches_gagnees', (select coalesce(sum(mg), 0) from joues j where j.entry = e.id),
    'manches_perdues', (select coalesce(sum(mp), 0) from joues j where j.entry = e.id),
    'points', (select coalesce(sum(points), 0) from volees v where v.entry = e.id),
    'flechettes', (select coalesce(sum(fl), 0) from volees v where v.entry = e.id),
    'finishs', (select count(*) from volees v where v.entry = e.id and v.is_checkout),
    'flechettes_double', (select coalesce(sum(darts_at_double), 0) from volees v where v.entry = e.id),
    'nb_180', (select count(*) from volees v where v.entry = e.id and not v.is_bust and v.score = 180),
    'meilleur_finish', (select max(remaining_before) from volees v where v.entry = e.id and v.is_checkout),
    'forfaits', (select count(*) from public.tournament_matches m where m.tournament_id = p_tournoi and m.forfeit
                   and m.winner_entry is distinct from e.id and e.id in (m.entry_a, m.entry_b))
  )), '[]'::json) into resultat
  from public.tournament_entries e where e.tournament_id = p_tournoi;
  return resultat;
end;
$$;

revoke execute on function public.stats_tournoi(uuid) from public;
grant execute on function public.stats_tournoi(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
