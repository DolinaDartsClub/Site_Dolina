-- =====================================================================
--  067 · Prolongation des matchs « premier à N »
--  Option du format des matchs d'un tournoi ou d'une ligue : si les deux
--  joueurs arrivent à N-1 manches partout, il faut N+1 manches pour gagner
--  (ex. premier à 4 manches ; à 3-3, le premier à 5 l'emporte).
--  Le scorer applique la règle tout seul.
--  À exécuter après le script 066.
-- =====================================================================

alter table public.games add column if not exists prolongation boolean not null default false;

create or replace function public.verifier_format_match(f jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v text := f ->> 'variant';
  s int;
  lk text := f ->> 'legs_kind';
  ln int := nullif(f ->> 'legs_n', '')::int;
  sk text := nullif(f ->> 'sets_kind', '');
  sn int := nullif(f ->> 'sets_n', '')::int;
begin
  if v is null or v not in ('301', '501', 'libre') then
    raise exception 'Choisissez le jeu des matchs : 301, 501 ou score libre.';
  end if;
  s := case v when '301' then 301 when '501' then 501 else nullif(f ->> 'start_score', '')::int end;
  if s is null or s < 2 or s > 9999 then
    raise exception 'Le score de départ doit être compris entre 2 et 9999.';
  end if;
  if lk is null or lk not in ('best_of', 'first_to') or ln is null or ln < 1 or ln > 21 then
    raise exception 'Indiquez le nombre de manches (de 1 à 21).';
  end if;
  if lk = 'best_of' and ln % 2 = 0 then
    raise exception '« Au meilleur de » demande un nombre impair de manches.';
  end if;
  if sk is not null then
    if sk not in ('best_of', 'first_to') or sn is null or sn < 1 or sn > 15 then
      raise exception 'Indiquez le nombre de sets (de 1 à 15).';
    end if;
    if sk = 'best_of' and sn % 2 = 0 then
      raise exception '« Au meilleur de » demande un nombre impair de sets.';
    end if;
  else
    sn := null;
  end if;
  -- 067 : prolongation (premier à N : à N-1 partout, il faut N+1 manches)
  return jsonb_build_object('variant', v, 'start_score', s, 'legs_kind', lk, 'legs_n', ln, 'sets_kind', sk, 'sets_n', sn,
    'prolongation', lk = 'first_to' and ln >= 2 and coalesce((f ->> 'prolongation')::boolean, false));
end;
$$;

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
  if m.status = 'live' then
    raise exception 'Ce match est déjà en cours : suivez-le en direct depuis le tournoi.';
  elsif m.status = 'done' then
    raise exception 'Ce match est déjà terminé.';
  elsif m.status <> 'ready' then
    raise exception 'Ce match ne peut pas encore être joué : ses joueurs ne sont pas encore connus.';
  end if;

  -- Chaque poule joue sur ses cibles : autant de matchs en même temps que de cibles
  if m.phase = 'pool' then
    select string_agg('M' || o.match_no, ', '), count(*) into occupe, n_live
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'pool' and o.pool_no = m.pool_no
      and o.status = 'live' and o.id <> m.id;
    if n_live >= coalesce(t.cibles_par_poule, 1) then
      raise exception '% de la poule % occupée% (% en cours). Augmentez le nombre de cibles par poule pour lancer un match de plus.',
        case when coalesce(t.cibles_par_poule, 1) > 1 then 'Les ' || t.cibles_par_poule || ' cibles' else 'La cible' end,
        chr(64 + m.pool_no), case when coalesce(t.cibles_par_poule, 1) > 1 then 's' else '' end, occupe;
    end if;
    occupe := null;
  end if;

  -- Phase finale : autant de matchs en même temps que de cibles (sans limite si non réglé)
  if m.phase = 'final' and t.cibles_finale is not null then
    select string_agg('M' || o.match_no, ', '), count(*) into occupe, n_live
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'final' and o.status = 'live' and o.id <> m.id;
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
                            visibility, first_side, show_checkout, tournament_match_id, prolongation)
  values (auth.uid(), f ->> 'variant', (f ->> 'start_score')::int,
          case when t.team_mode = 'double' then 'double' else 'single' end,
          f ->> 'legs_kind', (f ->> 'legs_n')::int, nullif(f ->> 'sets_kind', ''), nullif(f ->> 'sets_n', '')::int,
          case when t.public_matches then 'public' else 'private' end,
          case when p_premier = 2 then 2 else 1 end, t.show_checkout, m.id,
          f ->> 'legs_kind' = 'first_to' and coalesce((f ->> 'prolongation')::boolean, false))
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
