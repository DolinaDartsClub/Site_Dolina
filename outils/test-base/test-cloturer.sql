-- Script 053 : clôturer un match (nul ou sans suite)
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\pset tuples_only on
\pset format unaligned
create or replace function _joue(mid uuid, legs int) returns uuid language plpgsql as $$
declare g uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  g := lancer_match_tournoi(mid);
  insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double)
  select g, 1, l, 1, 1, 40, 40, true, 2, 1 from generate_series(1, legs) l;
  return g;
end $$;
-- Élimination directe à 4 avec 3e place, en 501 premier à 2
select _t(:'W', 'créer KO4', $$insert into tournaments(name, format, max_participants, status, third_place) values ('Clot KO', 'knockout', 8, 'open', true) returning id::text$$);
select set_config('t.k', (select id::text from tournaments where name = 'Clot KO'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.k')::uuid, 'C' || i from generate_series(1, 4) i;
select _t(:'W', 'lancer', $$select lancer_tournoi(current_setting('t.k')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}')::text$$);
select set_config('t.demi', (select id::text from tournament_matches where tournament_id = current_setting('t.k')::uuid and round_no = 1 order by match_no limit 1), false);
select _t(:'W', 'demi-finale : clôture refusée', $$select cloturer_match(current_setting('t.demi')::uuid, 'sans_suite')::text$$, 'il faut un vainqueur');
-- Jouer les deux demies (2-0)
do $$ declare m record; g uuid; begin
  for m in select * from tournament_matches where tournament_id = current_setting('t.k')::uuid and round_no = 1 and status = 'ready' order by match_no loop
    g := _joue(m.id, 2); update games set status = 'finished', winner_side = 1, finished_at = now() where id = g; perform valider_match_tournoi(g);
  end loop; end $$;
select set_config('t.p', (select id::text from tournament_matches where tournament_id = current_setting('t.k')::uuid and is_third_place), false);
select set_config('t.f', (select id::text from tournament_matches where tournament_id = current_setting('t.k')::uuid and phase = 'final' and not is_third_place and next_match_id is null), false);
-- 3e place : une manche finie, la 2e en cours (deux volées sans finish)
select set_config('t.gp', _joue(current_setting('t.p')::uuid, 1)::text, false);
insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double)
values (current_setting('t.gp')::uuid, 1, 2, 1, 2, 60, 501, false, 3, 0), (current_setting('t.gp')::uuid, 1, 2, 1, 1, 45, 501, false, 3, 0);
select _t(:'F', 'non organisateur : refusé', $$select cloturer_match(current_setting('t.p')::uuid, 'sans_suite')::text$$, 'Seul l''organisateur');
select _t(:'W', '3e place : sans suite', $$select cloturer_match(current_setting('t.p')::uuid, 'sans_suite')::text$$);
select _t(:'W', 'match terminé sans vainqueur, 1 manche à 0', $$select (1 / ((select status = 'done' and winner_entry is null and sans_suite and not nul and legs_a = 1 and legs_b = 0 from tournament_matches where id = current_setting('t.p')::uuid))::int)::text$$);
select _t(:'W', 'manche en cours effacée, manche finie gardée', $$select (1 / ((select count(*) from visits where game_id = current_setting('t.gp')::uuid) = 1
  and (select status = 'finished' and winner_side is null from games where id = current_setting('t.gp')::uuid))::int)::text$$);
select _t(:'W', 'tournoi pas encore fini (finale à jouer)', $$select (1 / ((select status = 'running' from tournaments where id = current_setting('t.k')::uuid))::int)::text$$);
select _t(:'W', 'finale : match nul', $$select cloturer_match(current_setting('t.f')::uuid, 'nul')::text$$);
select _t(:'W', 'tournoi terminé', $$select (1 / ((select status = 'finished' from tournaments where id = current_setting('t.k')::uuid))::int)::text$$);
select _t(:'W', 'détail : sans_suite visible', $$select (1 / ((select bool_or((m->>'sans_suite')::boolean) from json_array_elements(tournoi_detail(current_setting('t.k')::uuid)->'matchs') m))::int)::text$$);
select _t(:'W', 'remettre la 3e place à jouer', $$select reinitialiser_match(current_setting('t.p')::uuid)::text$$);
select _t(:'W', 'remise : plus sans suite, tournoi rouvert', $$select (1 / ((select status = 'ready' and not sans_suite from tournament_matches where id = current_setting('t.p')::uuid)
  and (select status = 'running' from tournaments where id = current_setting('t.k')::uuid))::int)::text$$);
-- Poule : nul = 1 point chacun, sans suite = 0
select _t(:'W', 'créer poule', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Clot P', 'pools', 8, 'open', 2) returning id::text$$);
select set_config('t.q', (select id::text from tournaments where name = 'Clot P'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.q')::uuid, 'D' || i from generate_series(1, 3) i;
select _t(:'W', 'lancer poule', $$select lancer_tournoi(current_setting('t.q')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 1)::text$$);
select set_config('t.m1', (select id::text from tournament_matches where tournament_id = current_setting('t.q')::uuid order by match_no limit 1), false);
select set_config('t.m2', (select id::text from tournament_matches where tournament_id = current_setting('t.q')::uuid order by match_no offset 1 limit 1), false);
select _t(:'W', 'poule : nul', $$select cloturer_match(current_setting('t.m1')::uuid, 'nul')::text$$);
select _t(:'W', 'poule : sans suite', $$select cloturer_match(current_setting('t.m2')::uuid, 'sans_suite')::text$$);
select _t(:'W', 'points : nul 1 chacun, sans suite 0', $$select (1 / ((select sum(points) from classement_poule(current_setting('t.q')::uuid, 1)) = 2
  and (select sum(joues) from classement_poule(current_setting('t.q')::uuid, 1)) = 2)::int)::text$$);

delete from tournaments where name in ('Clot KO', 'Clot P');
drop function _joue(uuid, int);
