-- =====================================================================
--  078 – Feuille CPARD : tout le monde peut scorer
--  - Avec le lien du capitaine adverse (sans compte) : scorer complet
--    (volée par volée) ou saisie du score, une fois la rencontre lancée.
--    La partie est alors au nom du capitaine qui a créé la feuille ; les
--    statistiques vont bien aux joueurs du club alignés.
--  - Tout membre du club connecté (même hors de l'équipe) : saisie du
--    score ou scorer complet.
--  Corriger un match déjà saisi reste réservé au capitaine qui gère.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 077.
--  Peut être relancé sans risque.
-- =====================================================================

create or replace function public.feuille_verifier_jouable(f public.feuilles_match, m public.feuille_matchs)
returns void language plpgsql stable set search_path = public as $$
declare
  manque text;
begin
  -- 078 : l'équipe, tout membre du club connecté, ou quiconque a le lien du capitaine adverse
  if not (public.feuille_peut_jouer(f.team_id) or public.is_active_member()
          or coalesce(current_setting('dolina.code_feuille', true), '') = f.code) then
    raise exception 'Seuls les membres du club et les personnes qui ont le lien de la feuille peuvent saisir les matchs.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : elle ne se modifie plus.';
  end if;
  if f.lancee_le is null then
    raise exception 'La rencontre n''est pas encore lancée : le capitaine qui reçoit la lance une fois les deux équipes saisies.';
  end if;
  manque := coalesce('équipe A : ' || public.feuille_compo_manque(f.compo_a, 'A'), 'équipe E : ' || public.feuille_compo_manque(f.compo_e, 'E'));
  if manque is not null then
    raise exception 'Composition incomplète (%) : complétez-la avant de jouer.', manque;
  end if;
end;
$$;

-- Saisie du score par le lien de la feuille (sans compte)
create or replace function public.saisir_resultat_feuille_code(p_code text, p_numero int, p_manches_a int, p_manches_e int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  fid uuid;
  cle text := upper(trim(coalesce(p_code, '')));
begin
  select id into fid from public.feuilles_match where code = cle;
  if fid is null then
    raise exception 'Ce lien de feuille de match n''est pas valide.';
  end if;
  perform set_config('dolina.code_feuille', cle, true);
  perform public.saisir_resultat_feuille(fid, p_numero, p_manches_a, p_manches_e);
  perform set_config('dolina.code_feuille', '', true);
end;
$$;


-- Lancer un match au scorer (compte du club ou lien de la feuille)
create or replace function public.lancer_match_feuille(p_feuille uuid, p_numero int)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  m public.feuille_matchs;
  o record;
  j jsonb;
  g uuid;
  cote int;
  liste jsonb;
  x jsonb;
  k int;
  occupe text;
  equipe text;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found then
    raise exception 'Cette feuille de match n''existe pas.';
  end if;
  select * into m from public.feuille_matchs where feuille_id = f.id and numero = p_numero for update;
  perform public.feuille_verifier_jouable(f, m);
  if m.statut = 'en_cours' then
    raise exception 'Ce match est déjà en cours dans le scorer.';
  elsif m.statut = 'termine' then
    raise exception 'Ce match est déjà terminé.';
  end if;
  select * into o from public.feuille_ordre() z where z.numero = p_numero;
  j := public.feuille_joueurs_match(f, p_numero);

  -- Un joueur ne joue qu'un match à la fois
  select string_agg(distinct x2 ->> 'n', ' et ') into occupe
  from public.feuille_matchs o2, jsonb_array_elements(o2.joueurs -> 'a') x2
  where o2.feuille_id = f.id and o2.statut = 'en_cours' and (j -> 'a') @> jsonb_build_array(x2);
  if occupe is null then
    select string_agg(distinct x2 ->> 'n', ' et ') into occupe
    from public.feuille_matchs o2, jsonb_array_elements(o2.joueurs -> 'e') x2
    where o2.feuille_id = f.id and o2.statut = 'en_cours' and (j -> 'e') @> jsonb_build_array(x2);
  end if;
  if occupe is not null then
    raise exception '% joue déjà un autre match : terminez-le avant de lancer celui-ci.', occupe;
  end if;

  select t.name into equipe from public.teams t where t.id = f.team_id;
  perform set_config('dolina.interne', 'oui', true);
  insert into public.games (created_by, variant, start_score, mode, legs_kind, legs_n, visibility,
                            first_side, show_checkout, match_type, feuille_match_id)
  -- 078 : lancé par le lien (sans compte) → la partie est au nom du capitaine qui a créé la feuille
  values (coalesce(auth.uid(), f.created_by, (select t.captain_id from public.teams t where t.id = f.team_id)), '501', 501, case when length(o.poste_a) = 2 then 'double' else 'single' end,
          'best_of', 3, 'public', case when o.premier = 'A' then 1 else 2 end, false, 'ligue', m.id)
  returning id into g;
  -- Camp 1 = équipe A, camp 2 = équipe E
  for cote in 1..2 loop
    liste := j -> case when cote = 1 then 'a' else 'e' end;
    insert into public.game_sides (game_id, side, name)
    values (g, cote, case when jsonb_array_length(liste) = 2 then left(
      case when (cote = 1) = (f.notre_camp = 'A') then equipe
           else (select r.adversaire from public.rencontres r where r.id = f.rencontre_id) end, 40) end);
    k := 0;
    for x in select * from jsonb_array_elements(liste) loop
      k := k + 1;
      insert into public.game_players (game_id, side, profile_id, guest_name, throw_order)
      values (g, cote, nullif(x ->> 'p', '')::uuid, case when nullif(x ->> 'p', '') is null then left(coalesce(x ->> 'n', 'Joueur'), 40) end, k);
    end loop;
  end loop;
  update public.feuille_matchs set statut = 'en_cours', saisie = 'scorer', game_id = g, joueurs = j, updated_at = now() where id = m.id;
  update public.feuilles_match set statut = 'en_cours', updated_at = now() where id = f.id and statut = 'composition';
  perform set_config('dolina.interne', '', true);
  return g;
end;
$$;

-- Contrôle commun : la partie appartient bien à la feuille de ce lien, et n'est pas validée
create or replace function public.partie_du_lien(p_code text, p_game uuid)
returns public.games language plpgsql stable security definer set search_path = public as $$
declare
  g public.games;
begin
  select g2.* into g from public.games g2
    join public.feuille_matchs m on m.id = g2.feuille_match_id
    join public.feuilles_match f on f.id = m.feuille_id
  where g2.id = p_game and f.code = upper(trim(coalesce(p_code, ''))) and f.statut <> 'validee' and m.statut = 'en_cours';
  if g.id is null then
    raise exception 'Ce match n''est plus modifiable par ce lien (déjà validé, corrigé ou lien invalide).';
  end if;
  return g;
end;
$$;

create or replace function public.lancer_match_feuille_code(p_code text, p_numero int)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  fid uuid;
  cle text := upper(trim(coalesce(p_code, '')));
  g uuid;
begin
  select id into fid from public.feuilles_match where code = cle;
  if fid is null then raise exception 'Ce lien de feuille de match n''est pas valide.'; end if;
  perform set_config('dolina.code_feuille', cle, true);
  g := public.lancer_match_feuille(fid, p_numero);
  perform set_config('dolina.code_feuille', '', true);
  return g;
end;
$$;

-- Une volée saisie par le lien
create or replace function public.volee_feuille_code(p_code text, p_game uuid, p_volee jsonb)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public.partie_du_lien(p_code, p_game);
  vid bigint;
begin
  if g.status <> 'live' then raise exception 'La partie est terminée.'; end if;
  perform set_config('dolina.interne', 'oui', true);
  insert into public.visits (game_id, set_no, leg_no, visit_no, side, player_id, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double)
  values (g.id, coalesce((p_volee ->> 'set_no')::int, 1), (p_volee ->> 'leg_no')::int, (p_volee ->> 'visit_no')::int, (p_volee ->> 'side')::int,
          nullif(p_volee ->> 'player_id', '')::uuid, (p_volee ->> 'score')::int, (p_volee ->> 'remaining_before')::int,
          coalesce((p_volee ->> 'is_bust')::boolean, false), coalesce((p_volee ->> 'is_checkout')::boolean, false),
          coalesce((p_volee ->> 'darts_used')::int, 3), coalesce((p_volee ->> 'darts_at_double')::int, 0))
  returning id into vid;
  perform set_config('dolina.interne', '', true);
  return vid;
end;
$$;

-- Annuler des volées par le lien
create or replace function public.annuler_volees_feuille_code(p_code text, p_game uuid, p_ids bigint[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public.partie_du_lien(p_code, p_game);
begin
  perform set_config('dolina.interne', 'oui', true);
  delete from public.visits where game_id = g.id and id = any(p_ids);
  perform set_config('dolina.interne', '', true);
end;
$$;

-- Fin de partie (ou reprise après annulation) par le lien
create or replace function public.statut_partie_feuille_code(p_code text, p_game uuid, p_fini boolean, p_gagnant int default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public.partie_du_lien(p_code, p_game);
begin
  if p_fini and p_gagnant not in (1, 2) then raise exception 'Vainqueur inconnu.'; end if;
  perform set_config('dolina.interne', 'oui', true);
  update public.games set status = case when p_fini then 'finished' else 'live' end,
    winner_side = case when p_fini then p_gagnant end,
    finished_at = case when p_fini then coalesce(finished_at, now()) end
  where id = g.id;
  perform set_config('dolina.interne', '', true);
end;
$$;

-- Report du résultat sur la feuille, par le lien
create or replace function public.valider_match_feuille_code(p_code text, p_game uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public.partie_du_lien(p_code, p_game);
  m public.feuille_matchs;
  la int; le int;
begin
  select * into m from public.feuille_matchs where id = g.feuille_match_id for update;
  if g.status <> 'finished' or g.winner_side is null then
    raise exception 'La partie n''est pas terminée : terminez-la dans le scorer avant de valider.';
  end if;
  select count(*) filter (where side = 1), count(*) filter (where side = 2) into la, le
  from public.visits where game_id = g.id and is_checkout;
  update public.feuille_matchs set statut = 'termine', manches_a = least(la, 2), manches_e = least(le, 2), updated_at = now()
  where id = m.id;
end;
$$;

-- Abandon (le match redevient à jouer), par le lien
create or replace function public.abandonner_partie_feuille_code(p_code text, p_game uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public.partie_du_lien(p_code, p_game);
begin
  perform set_config('dolina.interne', 'oui', true);
  delete from public.games where id = g.id;
  perform set_config('dolina.interne', '', true);
end;
$$;

grant execute on function public.feuille_de_partie(uuid) to anon, authenticated;
grant execute on function public.lancer_match_feuille_code(text, int) to anon, authenticated;
grant execute on function public.volee_feuille_code(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.annuler_volees_feuille_code(text, uuid, bigint[]) to anon, authenticated;
grant execute on function public.statut_partie_feuille_code(text, uuid, boolean, int) to anon, authenticated;
grant execute on function public.valider_match_feuille_code(text, uuid) to anon, authenticated;
grant execute on function public.abandonner_partie_feuille_code(text, uuid) to anon, authenticated;
revoke execute on function public.partie_du_lien(text, uuid) from public, anon, authenticated;
grant execute on function public.saisir_resultat_feuille_code(text, int, int, int) to anon, authenticated;
notify pgrst, 'reload schema';
