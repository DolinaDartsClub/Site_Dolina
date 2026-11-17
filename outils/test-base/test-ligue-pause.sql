-- Script 077 : ligue — matchs en pause, reprise, classement, ordre des tournois
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
create or replace function _egal(label text, a text, b text) returns text language sql as $f$
  select case when a is not distinct from b then 'PASS  ' || label || '  → ' || coalesce(a, 'null') else 'FAIL  ' || label || '  attendu: ' || coalesce(b, 'null') || '  obtenu: ' || coalesce(a, 'null') end $f$;
select _t(:'T', 'ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue P', 'pools', 16, 'open', 2, true) returning id::text$$);
select _t(:'T', 'visible', $$update tournaments set ligue_visible = true where name = 'Ligue P' returning 'ok'$$);
insert into tournament_entries(tournament_id, profile_id) select t.id, p.id from tournaments t, profiles p where t.name = 'Ligue P' and p.id in (:'W', :'F', :'G', :'T');
select _t(:'T', 'lancer la ligue', $$select lancer_tournoi((select id from tournaments where name = 'Ligue P'), '{"variant":"501","legs_kind":"first_to","legs_n":4}', 1)::text$$);
select null from set_config('t.l', (select id::text from tournaments where name = 'Ligue P'), false);
create or replace function _m(a uuid, b uuid) returns uuid language sql as $f$
  select m.id from tournament_matches m join tournament_entries ea on ea.id = m.entry_a join tournament_entries eb on eb.id = m.entry_b
  where m.tournament_id = current_setting('t.l')::uuid and ((ea.profile_id = a and eb.profile_id = b) or (ea.profile_id = b and eb.profile_id = a)) $f$;
-- Will lance contre Franck, ne finit pas
select _t(:'W', 'Will–Franck lancé', $$select lancer_match_tournoi(_m('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'))::text$$);
select null from set_config('t.g', (select game_id::text from tournament_matches where id = _m(:'W', :'F')), false);
select _t(:'W', 'tout de suite après : la cible est prise', $$select lancer_match_tournoi(_m('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444'))::text$$, 'occupée');
-- Le match reste en pause (rien saisi depuis 2 h)
update games set created_at = now() - interval '2 hours' where id = current_setting('t.g')::uuid;
select _egal('match en pause : plus actif', partie_active(current_setting('t.g')::uuid)::text, 'false');
select _t(:'W', 'Will joue contre Gérald malgré son match en pause', $$select lancer_match_tournoi(_m('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444'))::text$$);
select _egal('le match en pause reste en cours, non validé', (select status from tournament_matches where id = _m(:'W', :'F')), 'live');
-- Reprise par l'autre joueur
select _t(:'F', 'Franck reprend le scorer', $$select reprendre_partie_tournoi(current_setting('t.g')::uuid)::text$$);
select _egal('Franck tient le score', (select created_by::text from games where id = current_setting('t.g')::uuid), :'F');
select _t(:'G', 'un autre joueur de la ligue ne reprend pas ce match', $$select reprendre_partie_tournoi(current_setting('t.g')::uuid)::text$$, 'Seuls les joueurs du match');
select _t(:'T', 'l''organisateur peut aussi reprendre', $$select reprendre_partie_tournoi(current_setting('t.g')::uuid)::text$$);
select _t(:'F', 'Franck reprend à nouveau', $$select reprendre_partie_tournoi(current_setting('t.g')::uuid)::text$$);
select _t(:'F', 'Franck saisit une volée', $$insert into visits (game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 1, 1, 60, 501) returning 'ok'$$);
select _egal('volée saisie : le match redevient actif', partie_active(current_setting('t.g')::uuid)::text, 'true');
-- Tournoi ordinaire : un joueur ne joue toujours qu'un match à la fois
select _t(:'T', 'tournoi', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, cibles_par_poule) values ('Tournoi P', 'pools', 16, 'open', 2, 4) returning id::text$$);
insert into tournament_entries(tournament_id, profile_id) select t.id, p.id from tournaments t, profiles p where t.name = 'Tournoi P' and p.id in (:'W', :'F', :'G', :'T');
select _t(:'T', 'lancer le tournoi', $$select lancer_tournoi((select id from tournaments where name = 'Tournoi P'), '{"variant":"501","legs_kind":"first_to","legs_n":1}', 1)::text$$);
select null from set_config('t.l', (select id::text from tournaments where name = 'Tournoi P'), false);
select _t(:'W', 'tournoi : Will–Franck', $$select lancer_match_tournoi(_m('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'))::text$$);
select _t(:'W', 'tournoi : Will déjà en match', $$select lancer_match_tournoi(_m('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444'))::text$$, 'déjà un match en cours');
-- Classement : points, puis différence de manches (avant les manches gagnées)
select _t(:'T', 'ligue C', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue Cl', 'pools', 16, 'open', 2, true) returning id::text$$);
insert into tournament_entries(tournament_id, profile_id) select t.id, p.id from tournaments t, profiles p where t.name = 'Ligue Cl' and p.id in (:'W', :'F', :'G', :'T');
select _t(:'T', 'lancer', $$select lancer_tournoi((select id from tournaments where name = 'Ligue Cl'), '{"variant":"501","legs_kind":"first_to","legs_n":4}', 1)::text$$);
select null from set_config('t.l', (select id::text from tournaments where name = 'Ligue Cl'), false);
-- P1 = Will, P2 = Franck, P3 = Gérald, P4 = Tony
create or replace function _res(a uuid, b uuid, la int, lb int) returns void language plpgsql as $f$
declare m tournament_matches; ea uuid; begin
  select * into m from tournament_matches where id = _m(a, b);
  select profile_id into ea from tournament_entries where id = m.entry_a;
  perform set_config('dolina.interne', 'oui', true);
  update tournament_matches set status = 'done',
    legs_a = case when ea = a then la else lb end, legs_b = case when ea = a then lb else la end,
    winner_entry = case when (case when ea = a then la else lb end) > (case when ea = a then lb else la end) then entry_a else entry_b end
  where id = m.id;
end $f$;
select _res(:'W', :'G', 4, 3);  -- Will bat Gérald 4-3
select _res(:'W', :'T', 3, 4);  -- Tony bat Will 4-3
select _res(:'F', :'G', 4, 0);  -- Franck bat Gérald 4-0
select _res(:'F', :'T', 2, 4);  -- Tony bat Franck 4-2
select _egal('classement : Tony, Franck (diff +2), Will (diff 0, plus de manches), Gérald',
  (select string_agg(p.first_name || ' ' || c.points || 'pts', ', ' order by c.rang) from classement_poule(current_setting('t.l')::uuid, 1) c join tournament_entries e on e.id = c.entry_id join profiles p on p.id = e.profile_id),
  'Tony 6pts, Franck 4pts, Will 4pts, Gérald 2pts');
-- Ordre des tournois sur l'accueil : tournoi en cours, puis la ligue
select _egal('accueil : tournoi en cours avant la ligue', (select string_agg(name, ', ' order by n) from (select name, row_number() over () n from tournois_en_cours()) x where name in ('Tournoi P', 'Ligue P')), 'Tournoi P, Ligue P');
