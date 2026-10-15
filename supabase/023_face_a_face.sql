-- =====================================================================
--  Étape 6c : face-à-face entre deux membres, et entre deux doublettes
--  À exécuter une fois dans Supabase (après 022) : SQL Editor > New query > Run
--
--  Membres : parties en 1 contre 1 où les deux joueurs se sont affrontés
--  avec leur compte. Doublettes : parties en 2 contre 2 entre ces deux
--  paires (mêmes joueurs, quel que soit l'ordre de jeu).
--  Parties terminées en 301 et 501 uniquement (matchs de tournoi compris).
--  Réservé aux membres validés.
-- =====================================================================

-- Calcul commun : p_parties = liste de (game_id, camp de A, camp de B)
create or replace function public.bilan_face_a_face(p_parties jsonb)
returns json language sql stable security definer set search_path = public as $$
  with parties as (
    select (x ->> 'game_id')::uuid as game_id, (x ->> 'side_a')::int as side_a, (x ->> 'side_b')::int as side_b
    from jsonb_array_elements(p_parties) x
  ),
  info as (
    select p.*, g.variant, g.winner_side, g.sets_n, coalesce(g.finished_at, g.updated_at) as fin, g.tournament_match_id
    from parties p join public.games g on g.id = p.game_id
  ),
  volees as (
    select case when v.side = i.side_a then 'a' else 'b' end as qui, v.*,
           case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as fl
    from info i join public.visits v on v.game_id = i.game_id and v.side in (i.side_a, i.side_b)
  ),
  joueur as (
    select q.qui,
      (select count(*) from info i where i.winner_side = case when q.qui = 'a' then i.side_a else i.side_b end) as victoires,
      (select count(*) from volees v where v.qui = q.qui and v.is_checkout) as manches,
      (select coalesce(sum(points), 0) from volees v where v.qui = q.qui) as points,
      (select coalesce(sum(fl), 0) from volees v where v.qui = q.qui) as flechettes,
      (select coalesce(sum(darts_at_double), 0) from volees v where v.qui = q.qui) as flechettes_double,
      (select max(remaining_before) from volees v where v.qui = q.qui and v.is_checkout) as meilleur_finish,
      (select count(*) from volees v where v.qui = q.qui and not v.is_bust and v.score = 180) as nb_180,
      (select max(score) from volees v where v.qui = q.qui and not v.is_bust) as meilleure_volee
    from (values ('a'), ('b')) q(qui)
  )
  select json_build_object(
    'matchs', (select count(*) from info),
    'derniere', (select max(fin) from info),
    'a', (select row_to_json(j) from joueur j where j.qui = 'a'),
    'b', (select row_to_json(j) from joueur j where j.qui = 'b'),
    'historique', coalesce((select json_agg(json_build_object(
        'game_id', i.game_id, 'date', i.fin, 'variant', i.variant, 'tournoi', i.tournament_match_id is not null,
        'gagnant', case when i.winner_side = i.side_a then 'a' else 'b' end,
        'manches_a', (select count(*) from volees v where v.game_id = i.game_id and v.qui = 'a' and v.is_checkout),
        'manches_b', (select count(*) from volees v where v.game_id = i.game_id and v.qui = 'b' and v.is_checkout),
        'moy_a', (select round(sum(points)::numeric / nullif(sum(fl), 0) * 3, 1) from volees v where v.game_id = i.game_id and v.qui = 'a'),
        'moy_b', (select round(sum(points)::numeric / nullif(sum(fl), 0) * 3, 1) from volees v where v.game_id = i.game_id and v.qui = 'b')
      ) order by i.fin desc) from info i), '[]'::json)
  );
$$;

-- Face-à-face entre deux membres (1 contre 1)
create or replace function public.face_a_face(
  p_a uuid, p_b uuid, p_variant text default null, p_debut timestamptz default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  parties jsonb;
begin
  if not public.is_active_member() then
    raise exception 'Le face-à-face est réservé aux membres du club.';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Choisissez deux joueurs différents.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.id, 'side_a', pa.side, 'side_b', pb.side)), '[]'::jsonb) into parties
  from public.games g
  join public.game_players pa on pa.game_id = g.id and pa.profile_id = p_a
  join public.game_players pb on pb.game_id = g.id and pb.profile_id = p_b and pb.side <> pa.side
  where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'single'
    and (select count(*) from public.game_sides s where s.game_id = g.id) = 2
    and (p_variant is null or g.variant = p_variant)
    and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut);
  return json_build_object(
    'joueur_a', (select json_build_object('id', p.id, 'nom', public.nom_affiche(p)) from public.profiles p where p.id = p_a),
    'joueur_b', (select json_build_object('id', p.id, 'nom', public.nom_affiche(p)) from public.profiles p where p.id = p_b),
    'bilan', public.bilan_face_a_face(parties)
  );
end;
$$;

-- Clé d'une doublette : les deux joueurs triés (identifiant du membre, ou « invité:nom »)
create or replace function public.cle_camp(p_game uuid, p_side int)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)), '|'
                    order by coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)))
  from public.game_players gp where gp.game_id = p_game and gp.side = p_side;
$$;

-- Doublettes connues (pour le choix dans la page), avec leur nombre de parties
create or replace function public.liste_doublettes()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'Réservé aux membres du club.';
  end if;
  return coalesce((
    select json_agg(json_build_object('cle', cle, 'noms', noms, 'parties', nb) order by nb desc, noms)
    from (
      select public.cle_camp(g.id, s.side) as cle,
             max((select string_agg(gp.display_name, ' & ' order by coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)))
                  from public.game_players gp where gp.game_id = g.id and gp.side = s.side)) as noms,
             count(*) as nb
      from public.games g join public.game_sides s on s.game_id = g.id
      where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'double'
      group by 1
    ) d
    where array_length(string_to_array(cle, '|'), 1) = 2), '[]'::json);
end;
$$;

-- Face-à-face entre deux doublettes (2 contre 2)
create or replace function public.face_a_face_doublettes(
  p_a text, p_b text, p_variant text default null, p_debut timestamptz default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  parties jsonb;
begin
  if not public.is_active_member() then
    raise exception 'Le face-à-face est réservé aux membres du club.';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Choisissez deux doublettes différentes.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('game_id', x.id, 'side_a', x.side_a, 'side_b', x.side_b)), '[]'::jsonb) into parties
  from (
    select g.id, sa.side as side_a, sb.side as side_b
    from public.games g
    join public.game_sides sa on sa.game_id = g.id
    join public.game_sides sb on sb.game_id = g.id and sb.side <> sa.side
    where g.status = 'finished' and g.variant in ('301', '501') and g.mode = 'double'
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and public.cle_camp(g.id, sa.side) = p_a and public.cle_camp(g.id, sb.side) = p_b
  ) x;
  return json_build_object('bilan', public.bilan_face_a_face(parties));
end;
$$;

revoke execute on function public.bilan_face_a_face(jsonb) from public, anon, authenticated;
revoke execute on function public.face_a_face(uuid, uuid, text, timestamptz) from public, anon;
revoke execute on function public.face_a_face_doublettes(text, text, text, timestamptz) from public, anon;
revoke execute on function public.liste_doublettes() from public, anon;
grant execute on function public.face_a_face(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.face_a_face_doublettes(text, text, text, timestamptz) to authenticated;
grant execute on function public.liste_doublettes() to authenticated;

notify pgrst, 'reload schema';
