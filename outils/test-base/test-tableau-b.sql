-- Script 052 : tableau B des non-qualifiés
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\pset tuples_only on
\pset format unaligned
create or replace function _joue_tout(tid uuid) returns void language plpgsql as $$
declare m record; g uuid; k int := 0;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  for m in select * from tournament_matches where tournament_id = tid and status = 'ready' order by match_no loop
    k := k + 1;
    g := lancer_match_tournoi(m.id);
    insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (g, 1, 1, 1, 1, 40, 40, true, 2, 1);
    update games set status = 'finished', winner_side = 1, finished_at = now() where id = g;
    perform valider_match_tournoi(g);
  end loop;
end $$;
-- 9 joueurs, 3 poules de 3, 2 qualifiés : les 3 troisièmes → poule unique
select _t(:'W', 'créer A9 avec tableau B', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, tournoi_b) values ('A9', 'pools', 16, 'open', 2, true) returning id::text$$);
select set_config('t.a', (select id::text from tournaments where name = 'A9'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.a')::uuid, 'J' || lpad(i::text, 2, '0') from generate_series(1, 9) i;
select _t(:'W', 'lancer 3 poules', $$select lancer_tournoi(current_setting('t.a')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":1}', 3)::text$$);
select _t(:'W', 'tableau B avant la fin des poules : refusé', $$select creer_tableau_b(current_setting('t.a')::uuid, null, 'poule')::text$$, 'Tous les matchs de poule');
select _joue_tout(current_setting('t.a')::uuid);
select _t(:'F', 'non organisateur : refusé', $$select creer_tableau_b(current_setting('t.a')::uuid, null, 'poule')::text$$, 'Seul l''organisateur');
select _t(:'W', 'créer le tableau B en poule unique', $$select creer_tableau_b(current_setting('t.a')::uuid, null, 'poule')::text$$);
select set_config('t.b', (select id::text from tournaments where parent_id = current_setting('t.a')::uuid), false);
select _t(:'W', 'B : 3 inscrits (les 3es), nom par défaut', $$select (1 / ((select count(*) from tournament_entries where tournament_id = current_setting('t.b')::uuid) = 3
  and (select name from tournaments where id = current_setting('t.b')::uuid) = 'A9 – Tableau B'
  and (select sans_phase_finale from tournaments where id = current_setting('t.b')::uuid))::int)::text$$);
select _t(:'W', 'deuxième tableau B refusé', $$select creer_tableau_b(current_setting('t.a')::uuid, null, 'poule')::text$$, 'existe déjà');
select _t(:'W', 'détail A : lien vers B', $$select (1 / ((tournoi_detail(current_setting('t.a')::uuid)->'tournoi'->'tableau_b'->>'id') = current_setting('t.b'))::int)::text$$);
select _t(:'W', 'lancer B (1 poule)', $$select lancer_tournoi(current_setting('t.b')::uuid, '{"variant":"301","legs_kind":"first_to","legs_n":1}', 1)::text$$);
select _joue_tout(current_setting('t.b')::uuid);
select _t(:'W', 'B terminé sans phase finale', $$select (1 / ((select status = 'finished' from tournaments where id = current_setting('t.b')::uuid))::int)::text$$);
select _t(:'W', 'pas de phase finale possible', $$select lancer_phase_finale(current_setting('t.b')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":1}')::text$$, 'phase finale');
-- 12 joueurs, 3 poules de 4 : 6 non-qualifiés en élimination directe
select _t(:'W', 'créer A12', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, tournoi_b) values ('A12', 'pools', 16, 'open', 2, true) returning id::text$$);
select set_config('t.a2', (select id::text from tournaments where name = 'A12'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.a2')::uuid, 'K' || lpad(i::text, 2, '0') from generate_series(1, 12) i;
select _t(:'W', 'lancer 3 poules de 4', $$select lancer_tournoi(current_setting('t.a2')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":1}', 3)::text$$);
select _joue_tout(current_setting('t.a2')::uuid);
select _t(:'W', 'tableau B en élimination directe', $$select creer_tableau_b(current_setting('t.a2')::uuid, 'Consolante', 'knockout', true)::text$$);
select _t(:'W', 'B : 6 inscrits, KO, 3e place', $$select (1 / ((select count(*) from tournament_entries e join tournaments b on b.id = e.tournament_id where b.parent_id = current_setting('t.a2')::uuid) = 6
  and (select format = 'knockout' and third_place and name = 'Consolante' from tournaments where parent_id = current_setting('t.a2')::uuid))::int)::text$$);
select _t(:'W', 'lancer B KO', $$select lancer_tournoi((select id from tournaments where parent_id = current_setting('t.a2')::uuid), '{"variant":"501","legs_kind":"first_to","legs_n":1}')::text$$);
select _t(:'W', 'tournoi A12 : phase finale encore possible', $$select lancer_phase_finale(current_setting('t.a2')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":1}')::text$$);

delete from tournaments where parent_id in (current_setting('t.a')::uuid, current_setting('t.a2')::uuid);
delete from tournaments where name in ('A9', 'A12');
drop function _joue_tout(uuid);
