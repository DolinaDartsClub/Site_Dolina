-- =====================================================================
--  073 – Matchs bâclés : alerte « saisie trop rapide » et « hors stats »
--  - Une partie terminée dont les volées ont été tapées à la chaîne
--    (au moins 6 volées saisies moins de 4 s après la précédente, et au
--    moins 30 % des volées) est marquée « à vérifier » : elle sort des
--    statistiques tant qu'un admin (ou l'organisateur du tournoi) n'a pas
--    décidé ; un match de tournoi « à vérifier » ne peut être validé que
--    par l'organisateur.
--  - Un admin peut sortir n'importe quelle partie terminée des
--    statistiques (moyennes, 180, records, classement général, fil du
--    club) : le résultat du match, lui, reste (tournoi, ligue…).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 072.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.games add column if not exists hors_stats boolean not null default false;
alter table public.games add column if not exists a_verifier boolean not null default false;

-- Saisie anormalement rapide ?
create or replace function public.partie_saisie_rapide(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with v as (
    select created_at - lag(created_at) over (order by id) as ecart from public.visits where game_id = p_game
  )
  select count(*) filter (where ecart < interval '4 seconds') >= 6
     and count(*) filter (where ecart < interval '4 seconds') >= 0.3 * greatest(count(*), 1)
  from v;
$$;

create or replace function public.partie_marquer_suspecte()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' and new.mode <> 'bot' then
    new.a_verifier := public.partie_saisie_rapide(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists parties_saisie_rapide on public.games;
create trigger parties_saisie_rapide before update of status on public.games
  for each row execute function public.partie_marquer_suspecte();

-- Décision sur une partie : garder ou exclure ses statistiques
-- (admin, ou organisateur du tournoi pour un match de tournoi)
create or replace function public.statistiques_partie(p_game uuid, p_garder boolean)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games;
  tid uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'Partie introuvable.'; end if;
  select tournament_id into tid from public.tournament_matches where id = g.tournament_match_id;
  if not (public.is_admin() or (tid is not null and public.tournoi_organisateur(tid))) then
    raise exception 'Seul un admin (ou l''organisateur du tournoi) peut décider des statistiques d''un match.';
  end if;
  if g.status <> 'finished' then
    raise exception 'Seule une partie terminée peut sortir des statistiques.';
  end if;
  perform set_config('dolina.interne', 'oui', true);
  update public.games set a_verifier = false, hors_stats = not p_garder where id = p_game;
  return json_build_object('hors_stats', not p_garder);
end;
$$;

-- Joueur d'un match à distance (071, en pause) : sans erreur si 071 n'est pas exécuté
create or replace function public.joueur_partie_distance(p_game uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  ok boolean;
begin
  if to_regprocedure('public.camp_distance(uuid)') is null then
    return false;
  end if;
  execute 'select public.camp_distance($1) is not null' into ok using p_game;
  return coalesce(ok, false);
end;
$$;

-- classement_membres (repris de 045_classement_ligue_tournoi.sql)
create or replace function public.classement_membres(
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null,
  p_equipe uuid default null,
  p_tous boolean default false
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  seuil int;
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Le classement est réservé aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;
  select coalesce((value #>> '{}')::int, 5) into seuil from public.settings where key = 'ranking_min_legs';
  seuil := coalesce(seuil, 5);

  with parties as (
    select gp.profile_id, g.id as game_id, gp.side, g.winner_side,
           (select count(*) from public.game_sides s where s.game_id = g.id) as nb_camps
    from public.games g
    join public.game_players gp on gp.game_id = g.id and gp.profile_id is not null
    join public.profiles pr on pr.id = gp.profile_id and pr.status = 'active'
    where g.status = 'finished' and not g.hors_stats and not g.a_verifier and g.variant in ('301', '501') and g.mode = 'single' and g.match_type <> 'amical'
      and (p_tous or g.match_type = 'ligue' or g.tournament_match_id is not null)   -- 045 : ligue et tournois seulement
      and (select count(*) from public.game_sides s2 where s2.game_id = g.id) >= 2   -- pas de partie seul
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
      and (p_equipe is null or exists (select 1 from public.team_members tm
                                       where tm.profile_id = gp.profile_id and tm.team_id = p_equipe and tm.status = 'accepted'))
  ),
  volees as (
    select p.profile_id, v.game_id, v.set_no, v.leg_no, v.visit_no, v.is_checkout, v.is_bust, v.score,
           v.remaining_before, v.darts_at_double,
           case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as fl
    from parties p join public.visits v on v.game_id = p.game_id and v.side = p.side
  ),
  finishs as (
    select p.profile_id, v.side = p.side as par_moi
    from parties p join public.visits v on v.game_id = p.game_id and v.is_checkout
  ),
  stats as (
    select pr.id as profile_id,
      (select count(*) from parties x where x.profile_id = pr.id and x.nb_camps >= 2) as matchs,
      (select count(*) from parties x where x.profile_id = pr.id and x.nb_camps >= 2 and x.winner_side = x.side) as victoires,
      (select count(*) from finishs f where f.profile_id = pr.id and f.par_moi) as manches_gagnees,
      (select count(*) from finishs f where f.profile_id = pr.id and not f.par_moi) as manches_perdues,
      (select count(*) from (select distinct game_id, set_no, leg_no from volees v where v.profile_id = pr.id) d) as manches_jouees,
      (select coalesce(sum(points), 0) from volees v where v.profile_id = pr.id) as points,
      (select coalesce(sum(fl), 0) from volees v where v.profile_id = pr.id) as flechettes,
      (select coalesce(sum(points), 0) from volees v where v.profile_id = pr.id and v.visit_no <= 3) as points_9,
      (select coalesce(sum(fl), 0) from volees v where v.profile_id = pr.id and v.visit_no <= 3) as flechettes_9,
      (select count(*) from volees v where v.profile_id = pr.id and v.is_checkout) as finishs,
      (select coalesce(sum(darts_at_double), 0) from volees v where v.profile_id = pr.id) as flechettes_double,
      (select max(remaining_before) from volees v where v.profile_id = pr.id and v.is_checkout) as meilleur_finish,
      (select count(*) from volees v where v.profile_id = pr.id and not v.is_bust and v.score = 180) as nb_180
    from public.profiles pr
    where pr.id in (select distinct profile_id from parties)
  )
  select json_build_object(
    'seuil', seuil,
    'joueurs', coalesce(json_agg(json_build_object(
      'profile_id', s.profile_id,
      'nom', (select public.nom_affiche(pr) from public.profiles pr where pr.id = s.profile_id),
      'equipes', (select string_agg(t.name, ', ' order by t.sort_order) from public.team_members tm join public.teams t on t.id = tm.team_id
                  where tm.profile_id = s.profile_id and tm.status = 'accepted'),
      'matchs', s.matchs, 'victoires', s.victoires,
      'manches_gagnees', s.manches_gagnees, 'manches_perdues', s.manches_perdues, 'manches_jouees', s.manches_jouees,
      'points', s.points, 'flechettes', s.flechettes, 'points_9', s.points_9, 'flechettes_9', s.flechettes_9,
      'finishs', s.finishs, 'flechettes_double', s.flechettes_double,
      'meilleur_finish', s.meilleur_finish, 'nb_180', s.nb_180,
      'classe', s.manches_jouees >= seuil
    ) order by s.victoires desc, s.manches_gagnees desc,
               (s.finishs::numeric / nullif(s.flechettes_double, 0)) desc nulls last,
               (s.points::numeric / nullif(s.flechettes, 0)) desc nulls last), '[]'::json)
  ) into resultat
  from stats s;
  return resultat;
end;
$$;


-- classement_doublettes (repris de 045_classement_ligue_tournoi.sql)
create or replace function public.classement_doublettes(
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  seuil int;
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Le classement est réservé aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;
  select coalesce((value #>> '{}')::int, 5) into seuil from public.settings where key = 'ranking_min_legs';
  seuil := coalesce(seuil, 5);

  with camps as (
    select g.id as game_id, s.side, g.winner_side,
           (select count(*) from public.game_sides x where x.game_id = g.id) as nb_camps,
           (select string_agg(coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)), '|' order by coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)))
              from public.game_players gp where gp.game_id = g.id and gp.side = s.side) as cle,
           (select string_agg(gp.display_name, ' & ' order by coalesce(gp.profile_id::text, 'invité:' || lower(gp.guest_name)))
              from public.game_players gp where gp.game_id = g.id and gp.side = s.side) as noms,
           (select array_agg(gp.profile_id) filter (where gp.profile_id is not null)
              from public.game_players gp where gp.game_id = g.id and gp.side = s.side) as membres
    from public.games g join public.game_sides s on s.game_id = g.id
    where g.status = 'finished' and not g.hors_stats and not g.a_verifier and g.variant in ('301', '501') and g.mode = 'double' and g.match_type <> 'amical'
      and (g.match_type = 'ligue' or g.tournament_match_id is not null)   -- 045 : ligue et tournois seulement
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
  ),
  -- une vraie doublette (2 joueurs) avec au moins un membre du club
  paires as (select * from camps where array_length(membres, 1) >= 1 and array_length(string_to_array(cle, '|'), 1) = 2),
  volees as (
    select p.cle, v.*, case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as fl
    from paires p join public.visits v on v.game_id = p.game_id and v.side = p.side
  ),
  finishs as (
    select p.cle, v.side = p.side as par_nous
    from paires p join public.visits v on v.game_id = p.game_id and v.is_checkout
  ),
  stats as (
    select p.cle, max(p.noms) as noms,
      count(*) filter (where p.nb_camps >= 2) as matchs,
      count(*) filter (where p.nb_camps >= 2 and p.winner_side = p.side) as victoires
    from paires p group by p.cle
  )
  select json_build_object(
    'seuil', seuil,
    'doublettes', coalesce(json_agg(json_build_object(
      'cle', s.cle, 'noms', s.noms, 'matchs', s.matchs, 'victoires', s.victoires,
      'manches_gagnees', (select count(*) from finishs f where f.cle = s.cle and f.par_nous),
      'manches_perdues', (select count(*) from finishs f where f.cle = s.cle and not f.par_nous),
      'manches_jouees', (select count(*) from (select distinct game_id, set_no, leg_no from volees v where v.cle = s.cle) d),
      'points', (select coalesce(sum(points), 0) from volees v where v.cle = s.cle),
      'flechettes', (select coalesce(sum(fl), 0) from volees v where v.cle = s.cle),
      'finishs', (select count(*) from volees v where v.cle = s.cle and v.is_checkout),
      'flechettes_double', (select coalesce(sum(darts_at_double), 0) from volees v where v.cle = s.cle),
      'meilleur_finish', (select max(remaining_before) from volees v where v.cle = s.cle and v.is_checkout),
      'nb_180', (select count(*) from volees v where v.cle = s.cle and not v.is_bust and v.score = 180)
    )), '[]'::json)
  ) into resultat
  from stats s;
  return resultat;
end;
$$;


-- fil_du_club (repris de 049_fil_doubles.sql)
create or replace function public.fil_du_club(p_decalage int default 0, p_limite int default 20)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  res json;
begin
  if not public.is_active_member() then
    raise exception 'Le fil du club est réservé aux membres.';
  end if;
  with parties as (
    select g.id, g.variant, g.start_score, g.winner_side, g.tournament_match_id, g.match_type, g.mode,
           coalesce(g.finished_at, g.updated_at) as fin
    from public.games g
    where g.status = 'finished' and not g.hors_stats and not g.a_verifier and g.mode in ('single', 'double') and g.match_type <> 'amical'
      and (select count(*) from public.game_sides s where s.game_id = g.id) = 2
  ),
  joueurs as (
    select p.*, gp.side, gp.profile_id, gp.id as gp_id,
           (select string_agg(gp2.display_name, ' / ' order by gp2.throw_order) from public.game_players gp2 where gp2.game_id = p.id and gp2.side <> gp.side) as adversaire,
           (select string_agg(gp3.display_name, ' / ') from public.game_players gp3 where gp3.game_id = p.id and gp3.side = gp.side and gp3.id <> gp.id) as partenaire
    from parties p
    join public.game_players gp on gp.game_id = p.id and gp.profile_id is not null
    join public.profiles pr on pr.id = gp.profile_id and pr.status = 'active'
  ),
  -- Volées de chaque joueur. En double, le lanceur est déduit de l'alternance
  -- du scorer : les joueurs du camp lancent à tour de rôle (ordre de lancer),
  -- volée après volée, depuis le début de la partie.
  ordre_double as (
    select gp.game_id, gp.side, gp.id as gp_id,
           row_number() over (partition by gp.game_id, gp.side order by gp.throw_order, gp.id) - 1 as rang,
           count(*) over (partition by gp.game_id, gp.side) as nb
    from public.game_players gp
    where gp.game_id in (select id from parties where mode = 'double')
  ),
  volees as (
    select v.*, coalesce(v.player_id, o.gp_id) as lanceur
    from (
      select v.*, row_number() over (partition by v.game_id, v.side order by v.id) - 1 as n_volee
      from public.visits v where v.game_id in (select id from parties)
    ) v
    left join ordre_double o on o.game_id = v.game_id and o.side = v.side and o.rang = v.n_volee % o.nb
  ),
  perf as (
    select j.*,
      (select coalesce(sum(case when v.is_bust then 0 else v.score end), 0) from volees v where v.game_id = j.id and v.side = j.side and (j.mode = 'single' or v.lanceur = j.gp_id)) as points,
      (select coalesce(sum(case when v.is_checkout then v.darts_used else 3 end), 0) from volees v where v.game_id = j.id and v.side = j.side and (j.mode = 'single' or v.lanceur = j.gp_id)) as flechettes,
      (select count(*) from volees v where v.game_id = j.id and v.side = j.side and (j.mode = 'single' or v.lanceur = j.gp_id) and not v.is_bust and v.score = 180) as nb_180,
      (select count(*) from volees v where v.game_id = j.id and v.side = j.side and (j.mode = 'single' or v.lanceur = j.gp_id) and not v.is_bust and v.score >= 120 and v.score < 180) as nb_120,
      (select max(v.score) from volees v where v.game_id = j.id and v.side = j.side and (j.mode = 'single' or v.lanceur = j.gp_id) and not v.is_bust) as meilleure_volee,
      (select max(v.remaining_before) from volees v where v.game_id = j.id and v.side = j.side and (j.mode = 'single' or v.lanceur = j.gp_id) and v.is_checkout) as meilleur_finish,
      (select count(*) from volees v where v.game_id = j.id and v.side = j.side and v.is_checkout) as manches_pour,
      (select count(*) from volees v where v.game_id = j.id and v.side <> j.side and v.is_checkout) as manches_contre
    from joueurs j
  ),
  moy as (
    select p.*, case when p.flechettes > 0 then round(p.points::numeric / p.flechettes * 3, 1) end as moyenne
    from perf p
  ),
  -- Records : comparés à toutes les parties précédentes (du joueur, ou de tout le club)
  rec as (
    select m.*,
      max(m.moyenne) over (partition by m.profile_id order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_moy_perso,
      max(m.meilleur_finish) over (partition by m.profile_id order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_finish_perso,
      max(m.moyenne) over (order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_moy_club,
      max(m.meilleur_finish) over (order by m.fin, m.id rows between unbounded preceding and 1 preceding) as prec_finish_club
    from moy m
  ),
  annonces as (
    select r.*,
      (r.moyenne is not null and r.prec_moy_club is not null and r.moyenne > r.prec_moy_club) as record_club_moyenne,
      (r.meilleur_finish is not null and r.prec_finish_club is not null and r.meilleur_finish > r.prec_finish_club) as record_club_finish,
      (r.moyenne is not null and r.prec_moy_perso is not null and r.moyenne > r.prec_moy_perso) as record_perso_moyenne,
      (r.meilleur_finish is not null and r.prec_finish_perso is not null and r.meilleur_finish > r.prec_finish_perso) as record_perso_finish
    from rec r
  ),
  retenues as (
    select a.* from annonces a
    where (a.meilleur_finish >= 100 or a.nb_180 > 0 or a.nb_120 > 0 or a.moyenne >= 60
           or a.record_club_moyenne or a.record_club_finish or a.record_perso_moyenne or a.record_perso_finish)
    order by a.fin desc, a.id, a.side
    limit least(greatest(coalesce(p_limite, 20), 1), 50) offset greatest(coalesce(p_decalage, 0), 0)
  )
  select coalesce(json_agg(json_build_object(
    'game_id', r.id, 'fin', r.fin, 'variant', r.variant, 'start_score', r.start_score,
    'tournoi', r.tournament_match_id is not null, 'type', r.match_type,
    'joueur', (select json_build_object('id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name,
                 'nickname', pr.nickname, 'use_nickname', pr.use_nickname, 'photo_path', pr.photo_path)
               from public.profiles pr where pr.id = r.profile_id),
    'adversaire', r.adversaire, 'partenaire', r.partenaire, 'double', r.mode = 'double', 'gagne', r.winner_side = r.side,
    'manches_pour', r.manches_pour, 'manches_contre', r.manches_contre,
    'moyenne', r.moyenne, 'nb_180', r.nb_180, 'nb_120', r.nb_120,
    'meilleure_volee', r.meilleure_volee, 'meilleur_finish', r.meilleur_finish,
    'record_club_moyenne', r.record_club_moyenne, 'record_club_finish', r.record_club_finish,
    'record_perso_moyenne', r.record_perso_moyenne, 'record_perso_finish', r.record_perso_finish
  ) order by r.fin desc, r.id, r.side), '[]'::json) into res
  from retenues r;
  return res;
end;
$$;


-- records_club (repris de 032_records.sql)
create or replace function public.records_club(
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null,
  p_limite int default 10
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Les records sont réservés aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;

  with parties as (
    select gp.profile_id, g.id as game_id, gp.side, g.variant,
           coalesce(g.finished_at, g.updated_at) as quand
    from public.games g
    join public.game_players gp on gp.game_id = g.id and gp.profile_id is not null
    join public.profiles pr on pr.id = gp.profile_id and pr.status = 'active'
    where g.status = 'finished' and not g.hors_stats and not g.a_verifier and g.variant in ('301', '501') and g.mode = 'single' and g.match_type <> 'amical'
      and (select count(*) from public.game_sides s where s.game_id = g.id) >= 2
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
  ),
  -- Moyenne de chaque joueur sur chaque partie
  moyennes as (
    select p.profile_id, p.game_id, p.variant, p.quand,
           sum(case when v.is_bust then 0 else v.score end) as points,
           sum(case when v.is_checkout then v.darts_used else 3 end) as flechettes
    from parties p join public.visits v on v.game_id = p.game_id and v.side = p.side
    group by p.profile_id, p.game_id, p.variant, p.quand
  ),
  meilleures_moyennes as (
    select distinct on (profile_id) profile_id, game_id, variant, quand, flechettes,
           round(points::numeric * 3 / flechettes, 2) as moyenne
    from moyennes where flechettes >= 9
    order by profile_id, points::numeric / flechettes desc, quand
  ),
  meilleurs_finishs as (
    select distinct on (p.profile_id) p.profile_id, p.game_id, p.variant, p.quand,
           v.remaining_before as finish, v.darts_used as flechettes
    from parties p join public.visits v on v.game_id = p.game_id and v.side = p.side and v.is_checkout
    order by p.profile_id, v.remaining_before desc, p.quand
  ),
  -- Adversaires d'une partie (noms affichés, autres camps)
  adv as (
    select p.profile_id, p.game_id,
           string_agg(gp.display_name, ', ' order by gp.side, gp.throw_order) as adversaires
    from parties p join public.game_players gp on gp.game_id = p.game_id and gp.side <> p.side
    group by p.profile_id, p.game_id
  )
  select json_build_object(
    'moyennes', coalesce((
      select json_agg(x order by x.moyenne desc, x.quand) from (
        select m.profile_id, m.game_id, m.variant, m.quand, m.flechettes, m.moyenne,
               pr.first_name, pr.last_name, pr.nickname, pr.use_nickname, pr.photo_path,
               public.nom_affiche(pr) as nom, a.adversaires
        from meilleures_moyennes m
        join public.profiles pr on pr.id = m.profile_id
        left join adv a on a.profile_id = m.profile_id and a.game_id = m.game_id
        order by m.moyenne desc, m.quand
        limit greatest(1, least(p_limite, 50))
      ) x), '[]'::json),
    'finishs', coalesce((
      select json_agg(x order by x.finish desc, x.quand) from (
        select f.profile_id, f.game_id, f.variant, f.quand, f.flechettes, f.finish,
               pr.first_name, pr.last_name, pr.nickname, pr.use_nickname, pr.photo_path,
               public.nom_affiche(pr) as nom, a.adversaires
        from meilleurs_finishs f
        join public.profiles pr on pr.id = f.profile_id
        left join adv a on a.profile_id = f.profile_id and a.game_id = f.game_id
        order by f.finish desc, f.quand
        limit greatest(1, least(p_limite, 50))
      ) x), '[]'::json)
  ) into resultat;
  return resultat;
end;
$$;


-- stats_joueur (repris de 022_sans_solo.sql)
create or replace function public.stats_joueur(
  p_profile uuid,
  p_debut timestamptz default null,
  p_fin timestamptz default null,
  p_variant text default null
)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  resultat json;
begin
  if not public.is_active_member() then
    raise exception 'Les statistiques sont réservées aux membres du club.';
  end if;
  if p_variant is not null and p_variant not in ('301', '501') then
    raise exception 'Jeu inconnu : choisissez 301 ou 501.';
  end if;

  with parties as (
    select g.id, g.variant, coalesce(g.finished_at, g.updated_at) as fin, g.winner_side, gp.side,
           (select count(*) from public.game_sides s where s.game_id = g.id) as nb_camps
    from public.games g
    join public.game_players gp on gp.game_id = g.id and gp.profile_id = p_profile
    where g.status = 'finished' and not g.hors_stats and not g.a_verifier and g.variant in ('301', '501') and g.mode = 'single'
      and (select count(*) from public.game_sides s2 where s2.game_id = g.id) >= 2   -- pas de partie seul
      and (p_variant is null or g.variant = p_variant)
      and (p_debut is null or coalesce(g.finished_at, g.updated_at) >= p_debut)
      and (p_fin is null or coalesce(g.finished_at, g.updated_at) < p_fin)
  ),
  mes_volees as (
    select v.*, p.variant,
           case when v.is_bust then 0 else v.score end as points,
           case when v.is_checkout then v.darts_used else 3 end as flechettes
    from public.visits v join parties p on p.id = v.game_id and v.side = p.side
  ),
  mes_manches as (
    select game_id, set_no, leg_no, max(variant) as variant, sum(flechettes) as flechettes, bool_or(is_checkout) as gagnee
    from mes_volees group by game_id, set_no, leg_no
  ),
  finishs_partie as (       -- toutes les manches gagnées (par moi ou par un adversaire) dans mes parties
    select v.game_id, v.side = p.side as par_moi
    from public.visits v join parties p on p.id = v.game_id
    where v.is_checkout
  ),
  par_partie as (
    select p.id, p.fin, p.variant,
           sum(mv.points)::numeric as points, sum(mv.flechettes)::numeric as flechettes
    from parties p join mes_volees mv on mv.game_id = p.id
    group by p.id, p.fin, p.variant
  )
  select json_build_object(
    'joueur', (select json_build_object('id', pr.id, 'nom', public.nom_affiche(pr), 'prenom', pr.first_name, 'nom_famille', pr.last_name, 'surnom', pr.nickname)
               from public.profiles pr where pr.id = p_profile),
    'parties', (select count(*) from parties),
    'parties_bilan', (select count(*) from parties where nb_camps >= 2),
    'victoires', (select count(*) from parties where nb_camps >= 2 and winner_side = side),
    'defaites', (select count(*) from parties where nb_camps >= 2 and winner_side is distinct from side),
    'manches_gagnees', (select count(*) from finishs_partie where par_moi),
    'manches_perdues', (select count(*) from finishs_partie where not par_moi),
    'points', (select coalesce(sum(points), 0) from mes_volees),
    'flechettes', (select coalesce(sum(flechettes), 0) from mes_volees),
    'points_9', (select coalesce(sum(points), 0) from mes_volees where visit_no <= 3),
    'flechettes_9', (select coalesce(sum(flechettes), 0) from mes_volees where visit_no <= 3),
    'finishs', (select count(*) from mes_volees where is_checkout),
    'flechettes_double', (select coalesce(sum(darts_at_double), 0) from mes_volees),
    'meilleur_finish', (select max(remaining_before) from mes_volees where is_checkout),
    'meilleure_volee', (select max(score) from mes_volees where not is_bust),
    'nb_100', (select count(*) from mes_volees where not is_bust and score between 100 and 139),
    'nb_140', (select count(*) from mes_volees where not is_bust and score between 140 and 179),
    'nb_180', (select count(*) from mes_volees where not is_bust and score = 180),
    'manche_courte_301', (select min(flechettes) from mes_manches where gagnee and variant = '301'),
    'manche_courte_501', (select min(flechettes) from mes_manches where gagnee and variant = '501'),
    'meilleure_moyenne_partie', (select round(max(points / nullif(flechettes, 0) * 3), 1) from par_partie),
    'evolution', coalesce((
      select json_agg(json_build_object('id', id, 'date', fin, 'variant', variant,
                                        'moyenne', round(points / nullif(flechettes, 0) * 3, 1)) order by fin)
      from (select * from par_partie where flechettes > 0 order by fin desc limit 60) d), '[]'::json)
  ) into resultat;
  return resultat;
end;
$$;


-- stats_tournoi (repris de 020) : victoires gardées, points et moyennes exclus
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
          or (t.status in ('running', 'finished') and t.public_matches)) then
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

-- valider_match_tournoi : un match « à vérifier » est validé par l'organisateur
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
  -- (071, match à distance : lu sans dépendre de la colonne, pour fonctionner que 071 soit exécuté ou non)
  if not (g.created_by = auth.uid() or public.tournoi_organisateur(m.tournament_id)
          or (coalesce((to_jsonb(g) ->> 'a_distance')::boolean, false) and public.joueur_partie_distance(g.id))) or not public.is_active_member() then
    raise exception 'Seuls la personne qui a tenu le score, les joueurs d''un match à distance et l''organisateur peuvent valider ce résultat.';
  end if;
  -- 073 : saisie anormalement rapide → seul l'organisateur (ou un admin) tranche
  if g.a_verifier and not public.tournoi_organisateur(m.tournament_id) then
    raise exception 'Saisie très rapide détectée sur ce match : l''organisateur du tournoi doit vérifier et valider le résultat.';
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

grant execute on function public.statistiques_partie(uuid, boolean) to authenticated;
revoke execute on function public.partie_saisie_rapide(uuid) from public, anon;
grant execute on function public.partie_saisie_rapide(uuid) to authenticated;
notify pgrst, 'reload schema';
