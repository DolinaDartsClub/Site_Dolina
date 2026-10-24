-- =====================================================================
--  059 · Ligue interne : ajouter un membre après le lancement
--  Même si la ligue est complète, l'admin peut y ajouter un membre : une
--  place est créée, le joueur rejoint une poule et ses matchs contre chaque
--  joueur de la poule sont créés. Il les joue avant la fin de saison.
--  À exécuter après le script 058.
-- =====================================================================

create or replace function public.ajouter_joueur_en_cours(
  p_tournoi uuid,
  p_profile uuid default null,
  p_invite text default null,
  p_poule int default null,
  p_team_name text default null,
  p_partner_profile uuid default null,
  p_partner_guest text default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  poule int;
  nouveau uuid;
  journee int;
  numero int;
  adv record;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found then raise exception 'Ce tournoi n''existe pas.'; end if;
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut ajouter un joueur en cours de tournoi.';
  end if;
  if t.status <> 'running' then
    raise exception 'Le tournoi n''est pas en cours : ajoutez le joueur normalement.';
  end if;
  if t.format <> 'pools' then
    raise exception 'Impossible en élimination directe : l''arbre est déjà tiré.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final') then
    raise exception 'La phase finale a commencé : on ne peut plus ajouter de joueur.';
  end if;
  -- 059 : ligue interne complète → une place de plus pour le nouveau membre
  if t.est_ligue and (select count(*) from public.tournament_entries where tournament_id = p_tournoi) >= t.max_participants then
    if t.max_participants >= 64 then
      raise exception 'La ligue a atteint le maximum de 64 joueurs.';
    end if;
    perform set_config('dolina.interne', 'oui', true);
    update public.tournaments set max_participants = max_participants + 1 where id = p_tournoi;
    perform set_config('dolina.interne', '', true);
  end if;
  -- Poule choisie, sinon la moins remplie
  if p_poule is not null then
    if p_poule < 1 or p_poule > coalesce(t.pools_count, 1) then
      raise exception 'Cette poule n''existe pas.';
    end if;
    poule := p_poule;
  else
    select k into poule from generate_series(1, coalesce(t.pools_count, 1)) k
    order by (select count(*) from public.tournament_entries e where e.tournament_id = p_tournoi and e.pool_no = k), k
    limit 1;
  end if;

  perform set_config('dolina.ajout_en_cours', 'oui', true);
  insert into public.tournament_entries (tournament_id, profile_id, guest_name, team_name, partner_profile_id, partner_guest_name)
  values (p_tournoi, p_profile, case when p_profile is null then p_invite end, p_team_name, p_partner_profile, p_partner_guest)
  returning id into nouveau;
  perform set_config('dolina.ajout_en_cours', '', true);

  perform set_config('dolina.interne', 'oui', true);
  update public.tournament_entries set pool_no = poule,
    seed = (select coalesce(max(seed), 0) + 1 from public.tournament_entries where tournament_id = p_tournoi)
  where id = nouveau;

  -- Ses matchs : contre chaque joueur de la poule, dans une nouvelle journée
  select coalesce(max(round_no), 0) + 1 into journee from public.tournament_matches
   where tournament_id = p_tournoi and phase = 'pool' and pool_no = poule;
  select coalesce(max(match_no), 0) into numero from public.tournament_matches where tournament_id = p_tournoi;
  for adv in select id from public.tournament_entries
             where tournament_id = p_tournoi and pool_no = poule and id <> nouveau order by seed loop
    numero := numero + 1;
    insert into public.tournament_matches (tournament_id, match_no, phase, pool_no, round_no, entry_a, entry_b, status)
    values (p_tournoi, numero, 'pool', poule, journee, adv.id, nouveau, 'ready');
  end loop;
  return nouveau;
end;
$$;
revoke execute on function public.ajouter_joueur_en_cours(uuid, uuid, text, int, text, uuid, text) from public, anon;
grant execute on function public.ajouter_joueur_en_cours(uuid, uuid, text, int, text, uuid, text) to authenticated;


notify pgrst, 'reload schema';
