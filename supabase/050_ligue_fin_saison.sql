-- =====================================================================
--  050 – Ligue interne : fin de saison, matchs nuls, forfaits entre joueurs
--  Points de la ligue (et des poules) :
--    victoire 3 · défaite d'un match joué 1 · forfait 0 · match nul 1 chacun
--  Match nul : seulement dans la ligue, quand les deux joueurs sont d'accord.
--  Forfait ou nul entre joueurs : l'un propose, l'autre confirme ; rien ne
--  compte tant que les deux ne sont pas d'accord. L'organisateur (ou un
--  admin) peut toujours trancher lui-même.
--  Fin de saison : date limite fixée par l'admin ; les joueurs voient
--  leurs matchs restants et des rappels. Après la date, l'admin tranche.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 049.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.tournaments add column if not exists fin_saison date;
alter table public.tournament_matches add column if not exists nul boolean not null default false;

-- Un match remis à jouer ou corrigé avec un vainqueur n'est plus nul
create or replace function public.match_nul_coherent()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'done' or new.winner_entry is not null then
    new.nul := false;
  end if;
  return new;
end;
$$;
drop trigger if exists match_nul_coherent on public.tournament_matches;
create trigger match_nul_coherent before update on public.tournament_matches
  for each row execute function public.match_nul_coherent();

-- Classement d'une poule (et de la ligue) avec les nuls
create or replace function public.classement_poule(p_tournoi uuid, p_poule int)
returns table (entry_id uuid, rang int, points int, manches int, victoires int, joues int)
language sql stable security definer set search_path = public as $$
  with joueurs as (
    select e.id, e.seed from public.tournament_entries e where e.tournament_id = p_tournoi and e.pool_no = p_poule
  ), res as (
    select m.*, case when m.winner_entry = m.entry_a then m.entry_b else m.entry_a end as perdant
    from public.tournament_matches m
    where m.tournament_id = p_tournoi and m.phase = 'pool' and m.pool_no = p_poule and m.status = 'done'
      and (m.winner_entry is not null or m.nul)
  ), stats as (
    select j.id, j.seed,
      coalesce(sum(case when r.nul then 1 when r.winner_entry = j.id then 3 when r.forfeit then 0 else 1 end) filter (where r.id is not null), 0)::int as points,
      coalesce(sum(case when r.entry_a = j.id then coalesce(r.legs_a, r.score_a, 0) else coalesce(r.legs_b, r.score_b, 0) end) filter (where r.id is not null), 0)::int as manches,
      count(*) filter (where r.winner_entry = j.id)::int as victoires,
      count(r.id)::int as joues
    from joueurs j left join res r on r.entry_a = j.id or r.entry_b = j.id
    group by j.id, j.seed
  ), entre as (
    select s.id, count(r.id)::int as h2h
    from stats s
    left join res r on r.winner_entry = s.id
      and exists (select 1 from stats o where o.id = r.perdant and o.points = s.points and o.manches = s.manches)
    group by s.id
  )
  select s.id, (row_number() over (order by s.points desc, s.manches desc, e.h2h desc, s.seed))::int,
         s.points, s.manches, s.victoires, s.joues
  from stats s join entre e on e.id = s.id
  order by 2;
$$;

-- Enregistre un forfait ou un nul sur un match de ligue (usage interne)
create or replace function public.appliquer_resultat_ligue(p_match uuid, p_type text, p_perdant uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  perform set_config('dolina.interne', 'oui', true);
  if m.game_id is not null then
    delete from public.games where id = m.game_id;
  end if;
  if p_type = 'nul' then
    update public.tournament_matches set status = 'done', forfeit = false, game_id = null, winner_entry = null,
      score_a = null, score_b = null, legs_a = 0, legs_b = 0, validated_at = now(), validated_by = auth.uid()
    where id = m.id;
    update public.tournament_matches set nul = true where id = m.id;
  else
    update public.tournament_matches set status = 'done', forfeit = true, game_id = null,
      winner_entry = case when p_perdant = m.entry_a then m.entry_b else m.entry_a end,
      score_a = null, score_b = null, legs_a = 0, legs_b = 0, validated_at = now(), validated_by = auth.uid()
    where id = m.id;
  end if;
  update public.propositions_ligue set statut = 'remplacee', repondu_le = now()
   where match_id = m.id and statut = 'en_attente';
end;
$$;
revoke execute on function public.appliquer_resultat_ligue(uuid, text, uuid) from public, anon, authenticated;

-- Propositions entre joueurs : forfait ou match nul, à confirmer par l'adversaire
create table if not exists public.propositions_ligue (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  type text not null check (type in ('forfait', 'nul')),
  perdant uuid references public.tournament_entries(id) on delete cascade,   -- forfait : qui perd
  propose_par uuid not null references public.tournament_entries(id) on delete cascade,
  auteur uuid references public.profiles(id) on delete set null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'acceptee', 'refusee', 'annulee', 'remplacee')),
  cree_le timestamptz not null default now(),
  repondu_le timestamptz
);
create unique index if not exists propositions_ligue_une_par_match on public.propositions_ligue(match_id) where statut = 'en_attente';
alter table public.propositions_ligue enable row level security;
-- Lecture et écriture uniquement par les fonctions ci-dessous

-- Inscription du joueur connecté dans un match (null s'il n'y joue pas)
create or replace function public.mon_entree_match(m public.tournament_matches)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.tournament_entries e
  where e.id in (m.entry_a, m.entry_b) and (e.profile_id = auth.uid() or e.partner_profile_id = auth.uid())
  limit 1;
$$;
revoke execute on function public.mon_entree_match(public.tournament_matches) from public, anon, authenticated;

create or replace function public.proposer_resultat_ligue(p_match uuid, p_type text, p_perdant uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  moi uuid;
  pid uuid;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then raise exception 'Ce match n''existe pas.'; end if;
  select * into t from public.tournaments where id = m.tournament_id;
  if not t.est_ligue or m.phase <> 'pool' then
    raise exception 'Le forfait ou le nul entre joueurs se propose seulement dans la ligue interne.';
  end if;
  if t.status <> 'running' or not public.tournoi_participant(t.id) then
    raise exception 'La ligue n''est pas ouverte.';
  end if;
  moi := public.mon_entree_match(m);
  if moi is null then raise exception 'Vous ne jouez pas ce match.'; end if;
  if m.status <> 'ready' then
    raise exception 'Ce match est déjà en cours ou terminé.';
  end if;
  if p_type not in ('forfait', 'nul') then raise exception 'Type inconnu.'; end if;
  if p_type = 'forfait' and p_perdant is distinct from m.entry_a and p_perdant is distinct from m.entry_b then
    raise exception 'Indiquez qui déclare forfait.';
  end if;
  if exists (select 1 from public.propositions_ligue where match_id = m.id and statut = 'en_attente') then
    raise exception 'Une proposition attend déjà une réponse pour ce match.';
  end if;
  insert into public.propositions_ligue (match_id, type, perdant, propose_par, auteur)
  values (m.id, p_type, case when p_type = 'forfait' then p_perdant end, moi, auth.uid())
  returning id into pid;
  return pid;
end;
$$;

-- Réponse de l'adversaire (accepter / refuser) ; l'auteur peut annuler
create or replace function public.repondre_proposition_ligue(p_proposition uuid, p_reponse text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  p public.propositions_ligue;
  m public.tournament_matches;
  moi uuid;
begin
  select * into p from public.propositions_ligue where id = p_proposition for update;
  if not found or p.statut <> 'en_attente' then
    raise exception 'Cette proposition n''attend plus de réponse.';
  end if;
  select * into m from public.tournament_matches where id = p.match_id for update;
  moi := public.mon_entree_match(m);
  if p_reponse = 'annuler' then
    if moi is distinct from p.propose_par and not public.tournoi_organisateur(m.tournament_id) then
      raise exception 'Seul l''auteur de la proposition peut l''annuler.';
    end if;
    update public.propositions_ligue set statut = 'annulee', repondu_le = now() where id = p.id;
    return;
  end if;
  if moi is null or moi = p.propose_par then
    raise exception 'C''est à l''adversaire de répondre à cette proposition.';
  end if;
  if p_reponse = 'refuser' then
    update public.propositions_ligue set statut = 'refusee', repondu_le = now() where id = p.id;
  elsif p_reponse = 'accepter' then
    if m.status <> 'ready' then raise exception 'Ce match est déjà en cours ou terminé.'; end if;
    update public.propositions_ligue set statut = 'acceptee', repondu_le = now() where id = p.id;
    perform public.appliquer_resultat_ligue(m.id, p.type, p.perdant);
  else
    raise exception 'Réponse inconnue.';
  end if;
end;
$$;

-- L'organisateur (ou un admin) déclare un match nul dans la ligue
create or replace function public.match_nul_ligue(p_match uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  t public.tournaments;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found or not public.tournoi_organisateur(m.tournament_id) then
    raise exception 'Seul l''organisateur de la ligue (ou un admin) peut déclarer un match nul.';
  end if;
  select * into t from public.tournaments where id = m.tournament_id;
  if not t.est_ligue or m.phase <> 'pool' then
    raise exception 'Le match nul n''existe que dans la ligue interne.';
  end if;
  if m.status not in ('ready', 'live') then
    raise exception 'Un match nul se déclare sur un match à jouer ou en cours.';
  end if;
  perform public.appliquer_resultat_ligue(m.id, 'nul', null);
end;
$$;

-- Propositions en attente visibles par le joueur (les siennes) ou l'organisateur (toutes)
create or replace function public.propositions_ligue_en_cours(p_tournoi uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', p.id, 'match_id', p.match_id, 'type', p.type, 'perdant', p.perdant, 'propose_par', p.propose_par,
    'cree_le', p.cree_le, 'pour_moi', public.mon_entree_match(m) is not null and public.mon_entree_match(m) <> p.propose_par,
    'de_moi', public.mon_entree_match(m) = p.propose_par
  ) order by p.cree_le), '[]'::json)
  from public.propositions_ligue p join public.tournament_matches m on m.id = p.match_id
  where m.tournament_id = p_tournoi and p.statut = 'en_attente' and m.status = 'ready'
    and (public.tournoi_organisateur(p_tournoi) or (public.tournoi_participant(p_tournoi) and public.mon_entree_match(m) is not null));
$$;

-- Date de fin de saison (organisateur ou admin)
create or replace function public.definir_fin_saison(p_tournoi uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur de la ligue (ou un admin) peut fixer la fin de saison.';
  end if;
  update public.tournaments set fin_saison = p_date where id = p_tournoi and est_ligue;
  if not found then raise exception 'Cette ligue n''existe pas.'; end if;
end;
$$;

-- Rappels pour le joueur connecté : ses ligues en cours, matchs restants, propositions à traiter
create or replace function public.mes_rappels_ligue()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select t.id, t.name, t.fin_saison,
      (select count(*) from public.tournament_matches m
        where m.tournament_id = t.id and m.phase = 'pool' and m.status in ('ready', 'live')
          and e.id in (m.entry_a, m.entry_b)) as restants,
      (select count(*) from public.propositions_ligue p join public.tournament_matches m on m.id = p.match_id
        where m.tournament_id = t.id and p.statut = 'en_attente' and m.status = 'ready' and e.id in (m.entry_a, m.entry_b) and p.propose_par <> e.id) as a_repondre
    from public.tournaments t
    join public.tournament_entries e on e.tournament_id = t.id and (e.profile_id = auth.uid() or e.partner_profile_id = auth.uid())
    where t.est_ligue and t.status = 'running' and public.tournoi_participant(t.id)
  ) x where x.restants > 0 or x.a_repondre > 0;
$$;

revoke execute on function public.proposer_resultat_ligue(uuid, text, uuid) from public, anon;
revoke execute on function public.repondre_proposition_ligue(uuid, text) from public, anon;
revoke execute on function public.match_nul_ligue(uuid) from public, anon;
revoke execute on function public.propositions_ligue_en_cours(uuid) from public, anon;
revoke execute on function public.definir_fin_saison(uuid, date) from public, anon;
revoke execute on function public.mes_rappels_ligue() from public, anon;
grant execute on function public.proposer_resultat_ligue(uuid, text, uuid) to authenticated;
grant execute on function public.repondre_proposition_ligue(uuid, text) to authenticated;
grant execute on function public.match_nul_ligue(uuid) to authenticated;
grant execute on function public.propositions_ligue_en_cours(uuid) to authenticated;
grant execute on function public.definir_fin_saison(uuid, date) to authenticated;
grant execute on function public.mes_rappels_ligue() to authenticated;

-- Détail du tournoi : date de fin de saison et matchs nuls
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
        'format', m.format, 'corrected_at', m.corrected_at, 'nul', m.nul
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
