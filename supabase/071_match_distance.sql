-- =====================================================================
--  071 – Match de ligue à distance, avec caméra
--  - Un match de ligue peut être lancé « à distance » : chaque joueur
--    est chez lui, filme sa cible et saisit SES volées sur son téléphone.
--    Les deux téléphones partagent la même partie en direct.
--  - Seules les volées de son propre camp peuvent être saisies, corrigées
--    ou annulées (contrôlé par la base).
--  - Un match à distance n'occupe pas de cible du club.
--  - La vidéo passe directement d'un téléphone à l'autre (WebRTC) :
--    rien n'est enregistré ni stocké.
--  - Validation : chacun des deux joueurs (ou l'organisateur) peut valider ;
--    le reste des règles de la ligue ne change pas.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 070.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.games add column if not exists a_distance boolean not null default false;

-- Camp du joueur connecté dans une partie à distance (null s'il n'y joue pas)
create or replace function public.camp_distance(p_game uuid)
returns int language sql stable security definer set search_path = public as $$
  select min(p.side)::int from public.games g join public.game_players p on p.game_id = g.id
  where g.id = p_game and g.a_distance and p.profile_id = auth.uid() and public.is_active_member();
$$;

-- L'adversaire peut écrire SES volées dans une partie à distance
drop policy if exists visits_distance on public.visits;
create policy visits_distance on public.visits for all to authenticated
  using (public.camp_distance(game_id) = side) with check (public.camp_distance(game_id) = side);

-- Même le joueur qui a lancé la partie ne saisit que ses propres volées
create or replace function public.verrou_volees_distance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  idg uuid := coalesce(new.game_id, old.game_id);
  camp int;
begin
  if coalesce(current_setting('dolina.interne', true), '') = 'oui' or public.is_admin() then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.games g where g.id = idg and g.a_distance) then
    camp := public.camp_distance(idg);
    if camp is null or (tg_op <> 'INSERT' and old.side <> camp) or (tg_op <> 'DELETE' and new.side <> camp) then
      raise exception 'Match à distance : chaque joueur saisit uniquement ses propres volées.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists visites_verrou_distance on public.visits;
create trigger visites_verrou_distance before insert or update or delete on public.visits
  for each row execute function public.verrou_volees_distance();

-- Fin de partie (ou reprise après annulation) par l'un ou l'autre joueur
create or replace function public.statut_partie_distance(p_game uuid, p_fini boolean, p_gagnant int default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public.camp_distance(p_game) is null and not public.is_admin() then
    raise exception 'Seuls les deux joueurs peuvent terminer ce match à distance.';
  end if;
  if p_fini and p_gagnant not in (1, 2) then
    raise exception 'Vainqueur inconnu.';
  end if;
  update public.games
  set status = case when p_fini then 'finished' else 'live' end,
      winner_side = case when p_fini then p_gagnant end,
      finished_at = case when p_fini then coalesce(finished_at, now()) end
  where id = p_game and a_distance and status in ('live', 'finished');
end;
$$;

-- Lancement d'un match de tournoi : option « à distance »
drop function if exists public.lancer_match_tournoi(uuid, int);
create or replace function public.lancer_match_tournoi(p_match uuid, p_premier int default 1, p_distance boolean default false)
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
  n_live int;
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
  -- 071 : match à distance (caméra), pour la ligue, entre deux joueurs qui ont un compte
  p_distance := coalesce(p_distance, false);
  if p_distance then
    if not t.est_ligue then
      raise exception 'Le match à distance est réservé à la ligue.';
    end if;
    if t.team_mode = 'double' then
      raise exception 'Le match à distance se joue en individuel.';
    end if;
    if exists (select 1 from public.tournament_entries x where x.id in (m.entry_a, m.entry_b) and x.profile_id is null) then
      raise exception 'Pour jouer à distance, les deux joueurs doivent avoir un compte sur le site.';
    end if;
    if not public.tournoi_organisateur(t.id)
       and not exists (select 1 from public.tournament_entries x where x.id in (m.entry_a, m.entry_b) and x.profile_id = auth.uid()) then
      raise exception 'Seuls les deux joueurs du match peuvent le lancer à distance.';
    end if;
  end if;
  if m.status = 'live' then
    raise exception 'Ce match est déjà en cours : suivez-le en direct depuis le tournoi.';
  elsif m.status = 'done' then
    raise exception 'Ce match est déjà terminé.';
  elsif m.status <> 'ready' then
    raise exception 'Ce match ne peut pas encore être joué : ses joueurs ne sont pas encore connus.';
  end if;

  -- Chaque poule joue sur ses cibles : autant de matchs en même temps que de cibles
  if m.phase = 'pool' and not p_distance then
    select string_agg('M' || o.match_no, ', '), count(*) into occupe, n_live
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'pool' and o.pool_no = m.pool_no
      and o.status = 'live' and o.id <> m.id
      and not exists (select 1 from public.games gd where gd.id = o.game_id and gd.a_distance);
    if n_live >= coalesce(t.cibles_par_poule, 1) then
      raise exception '% de la poule % occupée% (% en cours). Augmentez le nombre de cibles par poule pour lancer un match de plus.',
        case when coalesce(t.cibles_par_poule, 1) > 1 then 'Les ' || t.cibles_par_poule || ' cibles' else 'La cible' end,
        chr(64 + m.pool_no), case when coalesce(t.cibles_par_poule, 1) > 1 then 's' else '' end, occupe;
    end if;
    occupe := null;
  end if;

  -- Phase finale : autant de matchs en même temps que de cibles (sans limite si non réglé)
  if m.phase = 'final' and t.cibles_finale is not null and not p_distance then
    select string_agg('M' || o.match_no, ', '), count(*) into occupe, n_live
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'final' and o.status = 'live' and o.id <> m.id
      and not exists (select 1 from public.games gd where gd.id = o.game_id and gd.a_distance);
    if n_live >= t.cibles_finale then
      raise exception '% de la phase finale occupée% (% en cours). Augmentez le nombre de cibles de la phase finale pour lancer un match de plus.',
        case when t.cibles_finale > 1 then 'Les ' || t.cibles_finale || ' cibles' else 'La cible' end,
        case when t.cibles_finale > 1 then 's' else '' end, occupe;
    end if;
    occupe := null;
  end if;

  -- Un joueur ne joue qu'un match à la fois
  select string_agg(public.nom_inscrit(x), ' et ') into occupe
  from public.tournament_entries x
  where x.id in (m.entry_a, m.entry_b)
    and exists (select 1 from public.tournament_matches o
                where o.tournament_id = m.tournament_id and o.status = 'live' and o.id <> m.id
                  and (o.entry_a = x.id or o.entry_b = x.id));
  if occupe is not null then
    raise exception '% % déjà un match en cours. Terminez-le avant de lancer celui-ci.', occupe,
      case when position(' et ' in occupe) > 0 then 'ont' else 'a' end;
  end if;

  f := coalesce(m.format, case when m.phase = 'pool' then t.pool_format else t.final_format end);
  if f is null then
    raise exception 'Le format des matchs de cette phase n''est pas défini.';
  end if;

  perform set_config('dolina.interne', 'oui', true);
  insert into public.games (created_by, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n,
                            visibility, first_side, show_checkout, tournament_match_id, prolongation, a_distance)
  values (auth.uid(), f ->> 'variant', (f ->> 'start_score')::int,
          case when t.team_mode = 'double' then 'double' else 'single' end,
          f ->> 'legs_kind', (f ->> 'legs_n')::int, nullif(f ->> 'sets_kind', ''), nullif(f ->> 'sets_n', '')::int,
          case when t.public_matches then 'public' else 'private' end,
          case when p_premier = 2 then 2 else 1 end, t.show_checkout, m.id,
          f ->> 'legs_kind' = 'first_to' and coalesce((f ->> 'prolongation')::boolean, false), p_distance)
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

-- Validation : les deux joueurs d'un match à distance peuvent valider
create or replace function public.valider_match_tournoi(p_game uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games;
  m public.tournament_matches;
  sa int; sb int; la int; lb int;
begin
  select * into g from public.games where id = p_game;
  if not found or g.tournament_match_id is null then
    raise exception 'Cette partie n''est pas un match de tournoi.';
  end if;
  select * into m from public.tournament_matches where id = g.tournament_match_id for update;
  if not (g.created_by = auth.uid() or public.tournoi_organisateur(m.tournament_id)
          or (g.a_distance and public.camp_distance(g.id) is not null)) or not public.is_active_member() then
    raise exception 'Seuls la personne qui a tenu le score, les joueurs d''un match à distance et l''organisateur peuvent valider ce résultat.';
  end if;
  if m.status = 'done' then
    return;                                  -- déjà validé (double clic, deux appareils…) : rien à refaire
  end if;
  if m.status <> 'live' or m.game_id is distinct from g.id then
    raise exception 'Ce match n''attend pas de validation.';
  end if;
  if g.status <> 'finished' or g.winner_side is null then
    raise exception 'La partie n''est pas terminée : terminez-la dans le scorer avant de valider.';
  end if;

  -- Manches gagnées par camp, et sets (le vainqueur d'un set est l'auteur de son dernier finish)
  select count(*) filter (where side = 1), count(*) filter (where side = 2) into la, lb
  from public.visits where game_id = g.id and is_checkout;
  if g.sets_n is not null then
    select count(*) filter (where side = 1), count(*) filter (where side = 2) into sa, sb
    from (select distinct on (set_no) set_no, side from public.visits
          where game_id = g.id and is_checkout order by set_no, id desc) d;
  else
    sa := la; sb := lb;
  end if;

  update public.tournament_matches set
    status = 'done',
    winner_entry = case when g.winner_side = 1 then entry_a else entry_b end,
    score_a = sa, score_b = sb, legs_a = la, legs_b = lb, forfeit = false,
    validated_at = now(), validated_by = auth.uid()
  where id = m.id;

  perform public.faire_avancer(m.id);
  perform public.verifier_fin_tournoi(m.tournament_id);
end;
$$;

grant execute on function public.camp_distance(uuid) to authenticated;
grant execute on function public.statut_partie_distance(uuid, boolean, int) to authenticated;
grant execute on function public.lancer_match_tournoi(uuid, int, boolean) to authenticated;
grant execute on function public.valider_match_tournoi(uuid) to authenticated;
notify pgrst, 'reload schema';
