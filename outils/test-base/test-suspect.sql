-- Script 073 : matchs « à vérifier » (saisie trop rapide) et « hors stats »
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
create or replace function _l(q text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  execute 'set local role authenticated';
  execute q into r;
  execute 'reset role';
  return r;
end $f$;
create or replace function _egal(label text, a text, b text) returns text language sql as $f$
  select case when a is not distinct from b then 'PASS  ' || label || '  → ' || coalesce(a, 'null') else 'FAIL  ' || label || '  attendu: ' || coalesce(b, 'null') || '  obtenu: ' || coalesce(a, 'null') end $f$;
\set CL 'select coalesce((select (x->>''matchs'') from json_array_elements(classement_membres(null, null, null, null, true)->''joueurs'') x where x->>''profile_id'' = ''11111111-1111-1111-1111-111111111111''), ''0'')'
\set ST 'select (stats_joueur(''11111111-1111-1111-1111-111111111111'')->>''parties'')'
-- Partie terminée Tony – Will, jouée normalement (volées espacées de 20 s)
create table g1 as select gen_random_uuid() as id;
insert into games (id, created_by, variant, start_score, mode, legs_kind, legs_n, status) select id, :'T', '501', 501, 'single', 'first_to', 1, 'live' from g1;
insert into game_sides (game_id, side) select id, s from g1, generate_series(1, 2) s;
insert into game_players (game_id, side, profile_id, display_name) select id, 1, :'T'::uuid, 'Tony' from g1 union all select id, 2, :'W'::uuid, 'Will' from g1;
insert into visits (game_id, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double, created_at)
  select (select id from g1), 1, (i + 1) / 2, 2 - i % 2, case when i = 17 then 21 else 60 end, case when i = 17 then 21 else 501 - 60 * ((i - 1) / 2) end, i = 17, 3, case when i = 17 then 1 else 0 end, now() - (17 - i) * interval '20 seconds'
  from generate_series(1, 17) i;
update games set status = 'finished', winner_side = 1, finished_at = now() where id = (select id from g1);
select _egal('partie normale terminée : pas d''alerte', (select a_verifier::text from games where id = (select id from g1)), 'false');
create table avant as select _l(:'CL')::int cl, _l(:'ST')::int st;
select _t(:'W', 'un membre ne sort pas une partie des stats', $$select statistiques_partie((select id from g1), false)::text$$, 'Seul un admin');
select _t(:'T', 'admin : partie hors stats', $$select statistiques_partie((select id from g1), false) ->> 'hors_stats'$$);
select _egal('classement : une partie de moins', _l(:'CL'), ((select cl from avant) - 1)::text);
select _egal('mes stats : une partie de moins', _l(:'ST'), ((select st from avant) - 1)::text);
select _t(:'T', 'admin : remise dans les stats', $$select statistiques_partie((select id from g1), true) ->> 'hors_stats'$$);
select _egal('classement rétabli', _l(:'CL'), (select cl from avant)::text);
-- Détection : volées tapées à la chaîne
select _t(:'W', 'partie de club', $$insert into games (created_by, variant, start_score, mode, legs_kind, legs_n) values ('22222222-2222-2222-2222-222222222222', '501', 501, 'single', 'first_to', 1) returning id::text$$);
select null from set_config('t.g', (select id::text from games where created_by = :'W' order by created_at desc limit 1), false);
insert into game_sides (game_id, side) select current_setting('t.g')::uuid, s from generate_series(1, 2) s on conflict do nothing;
select _t(:'W', '12 volées tapées d''un coup', $$insert into visits (game_id, leg_no, visit_no, side, score, remaining_before) select current_setting('t.g')::uuid, 1, (i + 1) / 2, 2 - i % 2, 60, 501 - 60 * ((i - 1) / 2) from generate_series(1, 12) i returning 'ok'$$);
select _t(:'W', 'fin de partie', $$update games set status = 'finished', winner_side = 1, finished_at = now() where id = current_setting('t.g')::uuid returning a_verifier::text$$);
select _egal('saisie trop rapide : à vérifier', (select a_verifier::text from games where id = current_setting('t.g')::uuid), 'true');
-- Partie normale : volées espacées de 20 s
select _t(:'W', 'partie de club normale', $$insert into games (created_by, variant, start_score, mode, legs_kind, legs_n) values ('22222222-2222-2222-2222-222222222222', '501', 501, 'single', 'first_to', 1) returning id::text$$);
select null from set_config('t.g2', (select id::text from games where created_by = :'W' and status = 'live' order by created_at desc limit 1), false);
insert into visits (game_id, leg_no, visit_no, side, score, remaining_before, created_at) select current_setting('t.g2')::uuid, 1, (i + 1) / 2, 2 - i % 2, 60, 501 - 60 * ((i - 1) / 2), now() - (12 - i) * interval '20 seconds' from generate_series(1, 12) i;
select _t(:'W', 'fin de la partie normale', $$update games set status = 'finished', winner_side = 1, finished_at = now() where id = current_setting('t.g2')::uuid returning a_verifier::text$$);
select _egal('partie normale : pas d''alerte', (select a_verifier::text from games where id = current_setting('t.g2')::uuid), 'false');
select _t(:'T', 'admin garde les stats de la partie rapide', $$select statistiques_partie(current_setting('t.g')::uuid, true) ->> 'hors_stats'$$);
select _egal('vérifiée : plus d''alerte', (select a_verifier::text || ' ' || hors_stats::text from games where id = current_setting('t.g')::uuid), 'false false');
-- Tournoi : un match « à vérifier » n'est validé que par l'organisateur
select _t(:'T', 'tournoi', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Tournoi S', 'pools', 16, 'open', 2) returning id::text$$);
insert into tournament_entries(tournament_id, profile_id) select t.id, p.id from tournaments t, profiles p where t.name = 'Tournoi S' and p.status = 'active';
select _t(:'T', 'lancer', $$select lancer_tournoi((select id from tournaments where name = 'Tournoi S'), '{"variant":"501","legs_kind":"first_to","legs_n":1}', 1)::text$$);
select null from set_config('t.m', (select m.id::text from tournament_matches m join tournament_entries e on e.id in (m.entry_a, m.entry_b) where m.tournament_id = (select id from tournaments where name = 'Tournoi S') and m.status = 'ready' and e.profile_id = :'W' limit 1), false);
select _t(:'W', 'Will lance son match', $$select lancer_match_tournoi(current_setting('t.m')::uuid)::text$$);
select null from set_config('t.tg', (select game_id::text from tournament_matches where id = current_setting('t.m')::uuid), false);
select _t(:'W', 'volées à la chaîne + finish', $$insert into visits (game_id, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) select current_setting('t.tg')::uuid, 1, (i + 1) / 2, 2 - i % 2, case when i = 13 then 81 else 60 end, case when i = 13 then 81 else 501 - 60 * ((i - 1) / 2) end, i = 13, 3, case when i = 13 then 1 else 0 end from generate_series(1, 13) i returning 'ok'$$);
select _t(:'W', 'fin du match', $$update games set status = 'finished', winner_side = (select side from game_players where game_id = current_setting('t.tg')::uuid and profile_id = '22222222-2222-2222-2222-222222222222'), finished_at = now() where id = current_setting('t.tg')::uuid returning a_verifier::text$$);
select _t(:'W', 'le marqueur ne valide pas un match à vérifier', $$select valider_match_tournoi(current_setting('t.tg')::uuid)::text$$, 'organisateur du tournoi doit vérifier');
select _t(:'T', 'l''organisateur exclut les stats puis valide', $$select statistiques_partie(current_setting('t.tg')::uuid, false) ->> 'hors_stats'$$);
select _t(:'T', 'validation par l''organisateur', $$select valider_match_tournoi(current_setting('t.tg')::uuid)::text$$);
select _egal('match terminé, partie hors stats', (select m.status || ' ' || g.hors_stats from tournament_matches m join games g on g.id = m.game_id where m.id = current_setting('t.m')::uuid), 'done true');
select _egal('stats du tournoi : victoire gardée, points exclus', (select (x ->> 'victoires') || ' victoire, ' || (x ->> 'points') || ' points' from json_array_elements(stats_tournoi((select id from tournaments where name = 'Tournoi S'))) x
  where x ->> 'entry_id' = (select id::text from tournament_entries where tournament_id = (select id from tournaments where name = 'Tournoi S') and profile_id = :'W')), '1 victoire, 0 points');
