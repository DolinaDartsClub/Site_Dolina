-- =====================================================================
--  Tournois en poules : une cible par poule
--  À exécuter une fois dans Supabase (après 027) : SQL Editor > New query > Run
--
--  Chaque poule joue sur sa cible : les poules avancent en parallèle,
--  mais dans une même poule un seul match est en cours à la fois ;
--  les matchs s'enchaînent dans l'ordre des journées.
-- =====================================================================

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

  -- Une poule joue sur une seule cible : un seul match de la poule à la fois
  if m.phase = 'pool' then
    select string_agg('M' || o.match_no, ', ') into occupe
    from public.tournament_matches o
    where o.tournament_id = m.tournament_id and o.phase = 'pool' and o.pool_no = m.pool_no
      and o.status = 'live' and o.id <> m.id;
    if occupe is not null then
      raise exception 'La cible de la poule % est occupée (% en cours). Les matchs d''une poule se jouent l''un après l''autre.', chr(64 + m.pool_no), occupe;
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

notify pgrst, 'reload schema';
