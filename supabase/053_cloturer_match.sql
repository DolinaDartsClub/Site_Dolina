-- =====================================================================
--  053 – Clôturer un match : nul ou « sans suite » (organisateur)
--  Pour terminer un tournoi quand un match ne peut pas aller au bout
--  (contrainte logistique, salle qui ferme…), l'organisateur peut le
--  déclarer :
--    - match nul : 1 point chacun en poule ;
--    - sans suite : aucun résultat, aucun point.
--  Les manches terminées restent dans les statistiques (moyennes…) ;
--  la manche en cours est effacée.
--  Seulement pour les matchs qui ne qualifient personne pour un tour
--  suivant : matchs de poule, match pour la 3e place, finale.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 052.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.tournament_matches add column if not exists sans_suite boolean not null default false;

create or replace function public.match_nul_coherent()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'done' or new.winner_entry is not null then
    new.nul := false;
    new.sans_suite := false;
  end if;
  return new;
end;
$$;

create or replace function public.cloturer_match(p_match uuid, p_issue text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  g public.games;
  la int := 0; lb int := 0; sa int; sb int;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found or not public.tournoi_organisateur(m.tournament_id) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut clôturer un match.';
  end if;
  if p_issue not in ('nul', 'sans_suite') then
    raise exception 'Choisissez « match nul » ou « sans suite ».';
  end if;
  if m.status not in ('ready', 'live') then
    raise exception 'Seul un match à jouer ou en cours peut être clôturé.';
  end if;
  if m.next_match_id is not null or m.loser_match_id is not null then
    raise exception 'Ce match qualifie pour le tour suivant : il faut un vainqueur. Utilisez « Forfait… » si un joueur ne peut pas le jouer.';
  end if;
  perform set_config('dolina.interne', 'oui', true);

  if m.game_id is not null then
    select * into g from public.games where id = m.game_id;
    -- La manche en cours (sans finish) est effacée ; les manches terminées restent
    delete from public.visits v
    where v.game_id = g.id and not exists (
      select 1 from public.visits w where w.game_id = v.game_id and w.set_no = v.set_no and w.leg_no = v.leg_no and w.is_checkout);
    if not exists (select 1 from public.visits where game_id = g.id) then
      delete from public.games where id = g.id;
      m.game_id := null;
    else
      update public.games set status = 'finished', winner_side = null, finished_at = coalesce(finished_at, now()) where id = g.id;
      select count(*) filter (where side = 1), count(*) filter (where side = 2) into la, lb
      from public.visits where game_id = g.id and is_checkout;
    end if;
  end if;
  if g.sets_n is not null and m.game_id is not null then
    select count(*) filter (where side = 1), count(*) filter (where side = 2) into sa, sb
    from (select distinct on (set_no) set_no, side from public.visits where game_id = g.id and is_checkout order by set_no, id desc) d;
  else
    sa := la; sb := lb;
  end if;

  update public.tournament_matches set
    status = 'done', winner_entry = null, forfeit = false, game_id = m.game_id,
    score_a = sa, score_b = sb, legs_a = la, legs_b = lb,
    nul = (p_issue = 'nul'), sans_suite = (p_issue = 'sans_suite'),
    validated_at = now(), validated_by = auth.uid()
  where id = m.id;
  update public.propositions_ligue set statut = 'remplacee', repondu_le = now() where match_id = m.id and statut = 'en_attente';
  perform public.verifier_fin_tournoi(m.tournament_id);
end;
$$;
revoke execute on function public.cloturer_match(uuid, text) from public, anon;
grant execute on function public.cloturer_match(uuid, text) to authenticated;

-- Détail du tournoi : matchs « sans suite »
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
      'tournoi_b', t.tournoi_b, 'sans_phase_finale', t.sans_phase_finale,
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
        'format', m.format, 'corrected_at', m.corrected_at, 'nul', m.nul, 'sans_suite', m.sans_suite
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
