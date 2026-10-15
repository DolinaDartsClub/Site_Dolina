-- =====================================================================
--  Tournois : « Corriger le score » (organisateur) et format des matchs
--  tour par tour dans la phase à élimination directe
--  À exécuter une fois dans Supabase (après 016) : SQL Editor > New query > Run
-- =====================================================================

-- Format propre à un match (sinon : format de la phase) ; trace des corrections
alter table public.tournament_matches add column if not exists format jsonb;
alter table public.tournament_matches add column if not exists corrected_at timestamptz;
alter table public.tournament_matches add column if not exists corrected_by uuid references public.profiles (id) on delete set null;


-- ---------------------------------------------------------------------
-- 1. CORRIGER LE SCORE D'UN MATCH TERMINÉ (organisateur ou admin)
--    Sans rejouer. Même vainqueur : toujours possible (seul le score change).
--    Vainqueur différent : seulement si les matchs suivants n'ont pas commencé.
--    Poules : impossible une fois la phase finale lancée.
--    p_score_a / p_score_b : manches (ou sets si le match se joue en sets)
--    p_legs_a / p_legs_b   : manches gagnées, si le match se joue en sets
-- ---------------------------------------------------------------------

create or replace function public.corriger_score_match(
  p_match uuid, p_score_a int, p_score_b int, p_legs_a int default null, p_legs_b int default null
)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  f jsonb;
  vainqueur uuid;
  perdant uuid;
  ancien_perdant uuid;
  bloque text;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found or not public.tournoi_organisateur(m.tournament_id) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut corriger un score.';
  end if;
  select * into t from public.tournaments where id = m.tournament_id for update;
  if m.status <> 'done' then
    raise exception 'Seul un match terminé peut être corrigé.';
  end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 or p_score_a > 99 or p_score_b > 99 then
    raise exception 'Indiquez le score de chaque joueur (nombre entier).';
  end if;
  if p_score_a = p_score_b then
    raise exception 'Il faut un vainqueur : les deux scores ne peuvent pas être égaux.';
  end if;
  f := coalesce(m.format, case when m.phase = 'pool' then t.pool_format else t.final_format end);
  if (f ->> 'sets_n') is null then
    p_legs_a := p_score_a; p_legs_b := p_score_b;
  elsif p_legs_a is null or p_legs_b is null or p_legs_a < p_score_a or p_legs_b < p_score_b then
    raise exception 'Indiquez aussi les manches gagnées par chaque joueur (au moins autant que de sets).';
  end if;
  if m.phase = 'pool' and exists (select 1 from public.tournament_matches where tournament_id = m.tournament_id and phase = 'final') then
    raise exception 'La phase finale est lancée : les résultats de poule ne peuvent plus être corrigés.';
  end if;

  vainqueur := case when p_score_a > p_score_b then m.entry_a else m.entry_b end;
  perdant := case when vainqueur = m.entry_a then m.entry_b else m.entry_a end;

  if vainqueur is distinct from m.winner_entry then
    -- Le vainqueur change : la suite du tournoi ne doit pas avoir commencé
    select string_agg('M' || x.match_no, ', ' order by x.match_no) into bloque from public.tournament_matches x
     where x.id in (m.next_match_id, m.loser_match_id) and (x.status in ('live', 'done') or x.game_id is not null);
    if bloque is not null then
      raise exception 'Le vainqueur change, mais le match suivant (%) a déjà commencé : corrigez-le d''abord (ou remettez-le à jouer).', bloque;
    end if;
    ancien_perdant := case when m.winner_entry = m.entry_a then m.entry_b else m.entry_a end;
    if m.next_match_id is not null then
      update public.tournament_matches set
        entry_a = case when m.next_slot = 'a' then vainqueur else entry_a end,
        entry_b = case when m.next_slot = 'b' then vainqueur else entry_b end
      where id = m.next_match_id;
    end if;
    if m.loser_match_id is not null then
      update public.tournament_matches set
        entry_a = case when m.loser_slot = 'a' then perdant else entry_a end,
        entry_b = case when m.loser_slot = 'b' then perdant else entry_b end
      where id = m.loser_match_id;
    end if;
  end if;

  update public.tournament_matches set
    winner_entry = vainqueur, score_a = p_score_a, score_b = p_score_b,
    legs_a = p_legs_a, legs_b = p_legs_b, forfeit = false,
    corrected_at = now(), corrected_by = auth.uid()
  where id = m.id;

  perform public.verifier_fin_tournoi(m.tournament_id);
end;
$$;


-- ---------------------------------------------------------------------
-- 2. FORMAT DES MATCHS D'UN TOUR (phase à élimination directe)
--    L'organisateur peut changer le nombre de manches (ou de sets) d'un
--    tour : seuls les matchs pas encore commencés sont concernés.
--    p_tour : numéro du tour (1 = premier tour) ; le match pour la 3e place
--    suit le format de la finale.
-- ---------------------------------------------------------------------

create or replace function public.definir_format_tour(p_tournoi uuid, p_tour int, p_format jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  f jsonb := public.verifier_format_match(p_format);
  n int;
begin
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut changer le format des matchs.';
  end if;
  if not exists (select 1 from public.tournaments where id = p_tournoi and status = 'running') then
    raise exception 'Le tournoi n''est pas en cours.';
  end if;
  update public.tournament_matches set format = f
   where tournament_id = p_tournoi and phase = 'final' and round_no = p_tour
     and status in ('waiting', 'ready') and game_id is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Tous les matchs de ce tour ont déjà commencé : le format ne peut plus changer.';
  end if;
  return n;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. LANCER UN MATCH : prend le format propre au match s'il existe
-- ---------------------------------------------------------------------

create or replace function public.lancer_match_tournoi(p_match uuid, p_premier int default 1)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  m public.tournament_matches;
  t public.tournaments;
  f jsonb;
  g uuid;
  autre int;
  cote int;
  e public.tournament_entries;
  occupe text;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then
    raise exception 'Ce match n''existe pas.';
  end if;
  select * into t from public.tournaments where id = m.tournament_id;
  if not (public.tournoi_organisateur(t.id) or public.tournoi_participant(t.id)) then
    raise exception 'Seuls les participants et l''organisateur du tournoi peuvent lancer un match.';
  end if;
  if t.status <> 'running' then
    raise exception 'Le tournoi n''est pas en cours.';
  end if;
  if m.status = 'live' then
    raise exception 'Ce match est déjà en cours : suivez-le en direct depuis le tournoi.';
  elsif m.status = 'done' then
    raise exception 'Ce match est déjà terminé.';
  elsif m.status <> 'ready' then
    raise exception 'Ce match ne peut pas encore être joué : ses joueurs ne sont pas encore connus.';
  end if;

  -- Un joueur ne joue qu'un match à la fois
  select string_agg(public.nom_inscrit(x), ' et ') into occupe
  from public.tournament_entries x
  where x.id in (m.entry_a, m.entry_b)
    and exists (select 1 from public.tournament_matches o
                where o.tournament_id = m.tournament_id and o.status = 'live' and o.id <> m.id
                  and (o.entry_a = x.id or o.entry_b = x.id));
  if occupe is not null then
    raise exception '% a déjà un match en cours. Terminez-le avant de lancer celui-ci.', occupe;
  end if;

  f := coalesce(m.format, case when m.phase = 'pool' then t.pool_format else t.final_format end);
  if f is null then
    raise exception 'Le format des matchs de cette phase n''est pas défini.';
  end if;

  perform set_config('dolina.interne', 'oui', true);
  insert into public.games (created_by, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n,
                            visibility, first_side, show_checkout, tournament_match_id)
  values (auth.uid(), f ->> 'variant', (f ->> 'start_score')::int,
          case when t.team_mode = 'double' then 'double' else 'single' end,
          f ->> 'legs_kind', (f ->> 'legs_n')::int, nullif(f ->> 'sets_kind', ''), nullif(f ->> 'sets_n', '')::int,
          case when t.public_matches then 'public' else 'private' end,
          case when p_premier = 2 then 2 else 1 end, t.show_checkout, m.id)
  returning id into g;

  -- Camp 1 = joueur A du match, camp 2 = joueur B
  for cote in 1..2 loop
    select * into e from public.tournament_entries where id = case when cote = 1 then m.entry_a else m.entry_b end;
    insert into public.game_sides (game_id, side, name) values (g, cote, case when t.team_mode = 'double' then left(e.team_name, 40) end);
    insert into public.game_players (game_id, side, profile_id, guest_name, throw_order)
    values (g, cote, e.profile_id, case when e.profile_id is null then coalesce(e.guest_name, 'Ancien joueur') end, 1);
    if t.team_mode = 'double' then
      insert into public.game_players (game_id, side, profile_id, guest_name, throw_order)
      values (g, cote, e.partner_profile_id, case when e.partner_profile_id is null then coalesce(e.partner_guest_name, 'Ancien joueur') end, 2);
    end if;
  end loop;

  update public.tournament_matches set status = 'live', game_id = g where id = m.id;
  perform set_config('dolina.interne', '', true);
  return g;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. LECTURE : format propre et correction de chaque match
-- ---------------------------------------------------------------------

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

  return json_build_object(
    'role', role,
    'tournoi', json_build_object(
      'id', t.id, 'code', case when role <> 'spectateur' then t.code end,
      'name', t.name, 'description', t.description, 'team_mode', t.team_mode, 'format', t.format,
      'max_participants', t.max_participants, 'pools_count', t.pools_count, 'pool_qualifiers', t.pool_qualifiers,
      'third_place', t.third_place, 'public_matches', t.public_matches, 'show_checkout', t.show_checkout, 'status', t.status,
      'pool_format', t.pool_format, 'final_format', t.final_format,
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
        'format', m.format, 'corrected_at', m.corrected_at
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;


revoke execute on function public.corriger_score_match(uuid, int, int, int, int) from public, anon;
revoke execute on function public.definir_format_tour(uuid, int, jsonb) from public, anon;
grant execute on function public.corriger_score_match(uuid, int, int, int, int) to authenticated;
grant execute on function public.definir_format_tour(uuid, int, jsonb) to authenticated;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
