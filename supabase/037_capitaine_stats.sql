-- =====================================================================
--  037 – Espace capitaine : retirer un joueur, forme des joueurs
--  - Le capitaine et le vice-capitaine peuvent retirer un joueur de leur
--    équipe (le vice ne peut pas retirer le capitaine).
--  - forme_equipe : derniers résultats de chaque joueur de l'équipe
--    (mêmes parties que le classement : 301/501 terminées, contre au moins
--    un adversaire, en individuel, hors matchs amicaux et dartbot).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 036.
--  Peut être relancé sans risque.
-- =====================================================================

drop policy if exists tm_delete on public.team_members;
create policy tm_delete on public.team_members for delete to authenticated
  using (
    profile_id = auth.uid()
    or public.is_admin()
    or (public.is_captain_of(team_id)
        and profile_id is distinct from (select t.captain_id from public.teams t where t.id = team_id))
  );

create or replace function public.forme_equipe(p_equipe uuid, p_n int default 5)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Réservé aux membres du club.';
  end if;
  with joueurs as (
    select tm.profile_id from public.team_members tm
    join public.profiles pr on pr.id = tm.profile_id and pr.status = 'active'
    where tm.team_id = p_equipe and tm.status = 'accepted'
  ),
  parties as (
    select j.profile_id, g.id, coalesce(g.finished_at, g.updated_at) as quand, (g.winner_side = gp.side) as gagne,
           row_number() over (partition by j.profile_id order by coalesce(g.finished_at, g.updated_at) desc) as rang
    from joueurs j
    join public.game_players gp on gp.profile_id = j.profile_id
    join public.games g on g.id = gp.game_id
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'single' and g.match_type <> 'amical'
      and (select count(*) from public.game_sides s where s.game_id = g.id) >= 2
  )
  select coalesce(json_agg(json_build_object(
    'profile_id', j.profile_id,
    'forme', (select coalesce(json_agg(case when p.gagne then 'V' else 'D' end order by p.rang), '[]'::json)
              from parties p where p.profile_id = j.profile_id and p.rang <= greatest(1, least(p_n, 10))),
    'derniere', (select max(p.quand) from parties p where p.profile_id = j.profile_id),
    'parties_30j', (select count(*) from parties p where p.profile_id = j.profile_id and p.quand >= now() - interval '30 days')
  )), '[]'::json) into resultat
  from joueurs j;
  return resultat;
end;
$$;
revoke execute on function public.forme_equipe(uuid, int) from public, anon;
grant execute on function public.forme_equipe(uuid, int) to authenticated;
