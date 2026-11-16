-- =====================================================================
--  076 – Ligue interne : accès des capitaines en lecture
--  Les capitaines et vice-capitaines des équipes du club voient la ligue
--  interne comme un spectateur : poules, classement, résultats des matchs
--  et récapitulatif du scoring (moyennes, 180, finishs…), sans rien
--  pouvoir modifier ni rejoindre. Le code de la ligue ne leur est pas
--  montré. La ligue doit être ouverte aux membres (« visible »).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 075.
--  Peut être relancé sans risque.
-- =====================================================================

-- Capitaine ou vice-capitaine d'au moins une équipe
create or replace function public.est_capitaine()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.teams t where auth.uid() in (t.captain_id, t.vice_captain_id)
  );
$$;

-- Ligue visible pour les capitaines
create or replace function public.ligue_ouverte_capitaine(p_tournoi uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.est_capitaine() and exists (
    select 1 from public.tournaments t where t.id = p_tournoi and t.est_ligue and t.ligue_visible
  );
$$;

drop policy if exists tournois_lecture on public.tournaments;
create policy tournois_lecture on public.tournaments for select to authenticated
  using ((created_by = auth.uid() and public.is_active_member()) or public.is_admin() or public.tournoi_participant(id)
         or public.ligue_ouverte_capitaine(id));
drop policy if exists inscrits_lecture on public.tournament_entries;
create policy inscrits_lecture on public.tournament_entries for select to authenticated
  using (public.tournoi_organisateur(tournament_id) or public.tournoi_participant(tournament_id) or public.ligue_ouverte_capitaine(tournament_id));
drop policy if exists matchs_tournoi_lecture on public.tournament_matches;
create policy matchs_tournoi_lecture on public.tournament_matches for select to authenticated
  using (public.tournoi_organisateur(tournament_id) or public.tournoi_participant(tournament_id) or public.ligue_ouverte_capitaine(tournament_id));

-- Fiche de la ligue (rôle « spectateur » pour les capitaines)
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
    when t.est_ligue and public.est_capitaine() then 'spectateur'   -- 076 : capitaines, en lecture
  end;
  if role is null then
    raise exception 'Ce tournoi est réservé à ses participants. Rejoignez-le avec son code.';
  end if;
  if t.est_ligue and not t.ligue_visible and not public.is_admin() then
    raise exception 'Cette ligue n''est pas encore ouverte aux membres.';
  end if;

  return json_build_object(
    'role', role,
    'tournoi', json_build_object(
      'id', t.id, 'code', case when role <> 'spectateur' then t.code end,
      'name', t.name, 'description', t.description, 'team_mode', t.team_mode, 'format', t.format,
      'max_participants', t.max_participants, 'pools_count', t.pools_count, 'pool_qualifiers', t.pool_qualifiers,
      'third_place', t.third_place, 'public_matches', t.public_matches, 'show_checkout', t.show_checkout, 'status', t.status,
      'pool_format', t.pool_format, 'final_format', t.final_format, 'cibles_par_poule', t.cibles_par_poule, 'cibles_finale', t.cibles_finale,
      'est_ligue', t.est_ligue, 'ligue_visible', t.ligue_visible, 'fin_saison', t.fin_saison,
      'tournoi_b', t.tournoi_b, 'sans_phase_finale', t.sans_phase_finale, 'b_double', t.b_double, 'format_b', t.format_b,
      'parent', (select json_build_object('id', pt.id, 'name', pt.name) from public.tournaments pt where pt.id = t.parent_id),
      'tableau_b', (select json_build_object('id', bt.id, 'name', bt.name, 'status', bt.status) from public.tournaments bt where bt.parent_id = t.id limit 1),
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
        'game_status', g.status, 'game_created_by', g.created_by, 'game_winner_side', g.winner_side,
        'format', m.format, 'corrected_at', m.corrected_at, 'nul', m.nul, 'sans_suite', m.sans_suite, 'tableau_b', m.tableau_b
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;

-- Récapitulatif du scoring de la ligue
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
          or (t.status in ('running', 'finished') and t.public_matches)
    or (t.est_ligue and (t.ligue_visible or public.is_admin()) and public.est_capitaine())) then
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
      and not exists (select 1 from public.games gh where gh.id = j.game_id and (gh.hors_stats or gh.a_verifier))
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

grant execute on function public.est_capitaine() to authenticated;
grant execute on function public.ligue_ouverte_capitaine(uuid) to authenticated;
notify pgrst, 'reload schema';
