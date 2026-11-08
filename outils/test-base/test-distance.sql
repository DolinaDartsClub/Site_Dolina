-- Script 071 : match de ligue à distance (caméra)
\set T '11111111-1111-1111-1111-111111111111'
\pset tuples_only on
\pset format unaligned
create or replace function _v(label text, q text, attendu text) returns text language plpgsql as $f$
declare r text; begin execute q into r;
  return case when r is not distinct from attendu then 'PASS  ' || label || '  → ' || coalesce(r, 'null') else 'FAIL  ' || label || '  attendu: ' || attendu || '  obtenu: ' || coalesce(r, 'null') end; end $f$;
select _t(:'T', 'ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue D', 'pools', 16, 'open', 2, true) returning id::text$$);
select _t(:'T', 'tournoi normal', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Tournoi N', 'pools', 16, 'open', 2) returning id::text$$);
select _t(:'T', 'ligue visible', $$update tournaments set ligue_visible = true where name = 'Ligue D' returning id::text$$);
insert into tournament_entries(tournament_id, profile_id) select t.id, p.id from tournaments t, profiles p where t.name in ('Ligue D', 'Tournoi N') and p.status = 'active';
select _t(:'T', 'lancer la ligue', $$select lancer_tournoi((select id from tournaments where name = 'Ligue D'), '{"variant":"501","legs_kind":"first_to","legs_n":1}', 1)::text$$);
select _t(:'T', 'lancer le tournoi', $$select lancer_tournoi((select id from tournaments where name = 'Tournoi N'), '{"variant":"501","legs_kind":"first_to","legs_n":1}', 1)::text$$);
-- match choisi : joueurs A (camp 1) et B (camp 2), C = un autre membre
select set_config('t.m', (select m.id::text from tournament_matches m join tournament_entries ea on ea.id = m.entry_a join tournament_entries eb on eb.id = m.entry_b
  join profiles pa on pa.id = ea.profile_id join profiles pb on pb.id = eb.profile_id
  where m.tournament_id = (select id from tournaments where name = 'Ligue D') and m.status = 'ready' and pa.role <> 'admin' and pb.role <> 'admin' order by m.match_no limit 1), false);
select set_config('t.a', (select e.profile_id::text from tournament_matches m join tournament_entries e on e.id = m.entry_a where m.id = current_setting('t.m')::uuid), false);
select set_config('t.b', (select e.profile_id::text from tournament_matches m join tournament_entries e on e.id = m.entry_b where m.id = current_setting('t.m')::uuid), false);
select set_config('t.x', (select p.id::text from profiles p where p.status = 'active' and p.role <> 'admin' and p.id::text not in (current_setting('t.a'), current_setting('t.b')) limit 1), false);
select _t(current_setting('t.x'), 'un autre joueur ne lance pas à distance', $$select lancer_match_tournoi(current_setting('t.m')::uuid, 1, true)::text$$, 'Seuls les deux joueurs');
select _t(:'T', 'tournoi normal : refusé', $$select lancer_match_tournoi((select id from tournament_matches where tournament_id = (select id from tournaments where name = 'Tournoi N') and status = 'ready' limit 1), 1, true)::text$$, 'réservé à la ligue');
select _t(current_setting('t.a'), 'joueur A lance à distance', $$select lancer_match_tournoi(current_setting('t.m')::uuid, 2, true)::text$$);
select set_config('t.g', (select game_id::text from tournament_matches where id = current_setting('t.m')::uuid), false);
select _v('partie à distance, B commence', $$select a_distance || ' ' || first_side from games where id = current_setting('t.g')::uuid$$, 'true 2');
-- La cible du club reste libre : un autre match de la poule peut être lancé
select _t(:'T', 'autre match en même temps (cible libre)', $$select lancer_match_tournoi((select o.id from tournament_matches o, tournament_matches l where l.id = current_setting('t.m')::uuid and o.tournament_id = l.tournament_id and o.pool_no = l.pool_no and o.status = 'ready' and o.entry_a not in (l.entry_a, l.entry_b) and o.entry_b not in (l.entry_a, l.entry_b) limit 1))::text$$);
select _t(current_setting('t.b'), 'B : camp 2', $$select camp_distance(current_setting('t.g')::uuid)::text$$);
select _t(current_setting('t.b'), 'B saisit sa volée', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 1, 2, 60, 501) returning id::text$$);
select _t(current_setting('t.b'), 'B ne saisit pas pour A', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 1, 1, 60, 501) returning id::text$$, 'propres volées');
select _t(current_setting('t.a'), 'A ne saisit pas pour B', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 2, 2, 60, 441) returning id::text$$, 'propres volées');
select _t(current_setting('t.a'), 'A saisit sa volée', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 1, 1, 100, 501) returning id::text$$);
select _t(current_setting('t.x'), 'un autre membre ne saisit rien', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 2, 2, 60, 441) returning id::text$$, 'propres volées');
select _t(current_setting('t.a'), 'A n''annule pas la volée de B', $$delete from visits where game_id = current_setting('t.g')::uuid and side = 2 returning id::text$$, 'propres volées');
select _v('volée de B toujours là', $$select count(*)::text from visits where game_id = current_setting('t.g')::uuid and side = 2$$, '1');
select _t(current_setting('t.b'), 'B annule sa volée', $$delete from visits where game_id = current_setting('t.g')::uuid and side = 2 returning id::text$$);
select _t(current_setting('t.b'), 'B finit la manche (checkout)', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (current_setting('t.g')::uuid, 1, 1, 2, 100, 100, true, 3, 1) returning id::text$$);
select _t(current_setting('t.x'), 'un autre membre ne termine pas la partie', $$select statut_partie_distance(current_setting('t.g')::uuid, true, 2)::text$$, 'Seuls les deux joueurs');
select _t(current_setting('t.b'), 'B termine la partie', $$select statut_partie_distance(current_setting('t.g')::uuid, true, 2)::text$$);
select _v('partie terminée, B gagne', $$select status || ' ' || winner_side from games where id = current_setting('t.g')::uuid$$, 'finished 2');
select _t(current_setting('t.x'), 'un autre membre ne valide pas', $$select valider_match_tournoi(current_setting('t.g')::uuid)::text$$, 'Seuls la personne');
select _t(current_setting('t.b'), 'B (adversaire) valide le résultat', $$select valider_match_tournoi(current_setting('t.g')::uuid)::text$$);
select _v('match terminé', $$select status from tournament_matches where id = current_setting('t.m')::uuid$$, 'done');
select _t(current_setting('t.b'), 'après validation : volées figées', $$delete from visits where game_id = current_setting('t.g')::uuid returning id::text$$, 'Résultat validé');
select _t(:'T', 'l''autre match est abandonné', $$delete from games g using tournament_matches m where m.game_id = g.id and m.status = 'live' and not g.a_distance returning g.id::text$$);
-- Abandon d'une partie à distance par celui qui l'a lancée (avec des volées des deux camps)
select set_config('t.m2', (select m.id::text from tournament_matches m join tournament_entries ea on ea.id = m.entry_a join tournament_entries eb on eb.id = m.entry_b
  join profiles pa on pa.id = ea.profile_id join profiles pb on pb.id = eb.profile_id
  where m.tournament_id = (select id from tournaments where name = 'Ligue D') and m.status = 'ready' and pa.role <> 'admin'
    and not exists (select 1 from tournament_matches l where l.tournament_id = m.tournament_id and l.status = 'live' and (l.entry_a in (m.entry_a, m.entry_b) or l.entry_b in (m.entry_a, m.entry_b)))
  order by m.match_no limit 1), false);
select set_config('t.a2', (select e.profile_id::text from tournament_matches m join tournament_entries e on e.id = m.entry_a where m.id = current_setting('t.m2')::uuid), false);
select set_config('t.b2', (select e.profile_id::text from tournament_matches m join tournament_entries e on e.id = m.entry_b where m.id = current_setting('t.m2')::uuid), false);
select _t(current_setting('t.a2'), 'nouveau match à distance', $$select lancer_match_tournoi(current_setting('t.m2')::uuid, 1, true)::text$$);
select set_config('t.g2', (select game_id::text from tournament_matches where id = current_setting('t.m2')::uuid), false);
select _t(current_setting('t.a2'), 'volée A', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g2')::uuid, 1, 1, 1, 45, 501) returning id::text$$);
select _t(current_setting('t.b2'), 'volée B', $$insert into visits(game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g2')::uuid, 1, 1, 2, 85, 501) returning id::text$$);
select _t(current_setting('t.a2'), 'abandon par celui qui a lancé (volées des deux camps)', $$delete from games where id = current_setting('t.g2')::uuid returning id::text$$);
select _v('match redevenu à jouer', $$select status from tournament_matches where id = current_setting('t.m2')::uuid$$, 'ready');
