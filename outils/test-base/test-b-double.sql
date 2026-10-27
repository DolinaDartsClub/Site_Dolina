-- Script 065 : tableau B en double élimination
\set T '11111111-1111-1111-1111-111111111111'
\pset tuples_only on
\pset format unaligned
-- Joue tous les matchs prêts (le joueur A gagne), autant de fois que nécessaire
create or replace function _jouer_tout(tid uuid) returns int language plpgsql as $$
declare m record; n int := 0; encore boolean := true;
begin
  perform set_config('dolina.interne', 'oui', true);
  while encore loop
    encore := false;
    for m in select * from tournament_matches where tournament_id = tid and status = 'ready' order by match_no loop
      update tournament_matches set status = 'done', winner_entry = entry_a, score_a = 2, score_b = 0 where id = m.id;
      perform faire_avancer(m.id); perform verifier_fin_tournoi(tid);
      n := n + 1; encore := true;
    end loop;
  end loop;
  return n;
end $$;
-- 8 joueurs
select _t(:'T', 'tournoi KO 8 avec tableau B', $$insert into tournaments(name, format, max_participants, status, third_place, b_double) values ('KO B8', 'knockout', 16, 'open', true, true) returning id::text$$);
select set_config('t.k', (select id::text from tournaments where name = 'KO B8'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.k')::uuid, 'J' || i from generate_series(1, 8) i;
select _t(:'T', 'lancer (format B à part)', $$select lancer_tournoi(current_setting('t.k')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":3}', null, '{"variant":"301","legs_kind":"first_to","legs_n":1}')::text$$);
select 'A : 7 matchs sans 3e place ; B : 5 matchs (2,2,1) en 301 → ' ||
  (select count(*) from tournament_matches where tournament_id = current_setting('t.k')::uuid and not tableau_b) || ' / 3e place ' ||
  (select count(*) from tournament_matches where tournament_id = current_setting('t.k')::uuid and is_third_place) || ' / B ' ||
  (select string_agg(n::text, ',' order by round_no) from (select round_no, count(*) n from tournament_matches where tournament_id = current_setting('t.k')::uuid and tableau_b group by round_no) x) || ' ' ||
  (select distinct format ->> 'variant' from tournament_matches where tournament_id = current_setting('t.k')::uuid and tableau_b);
select 'matchs joués : ' || _jouer_tout(current_setting('t.k')::uuid);
select '8 joueurs, tournoi terminé, 12 matchs joués (attendu finished 12) → ' || (select status from tournaments where id = current_setting('t.k')::uuid) || ' ' ||
  (select count(*) from tournament_matches where tournament_id = current_setting('t.k')::uuid and status = 'done');
select 'vainqueur A ≠ vainqueur B, finaliste A absent du B → ' ||
  ((select winner_entry from tournament_matches where tournament_id = current_setting('t.k')::uuid and not tableau_b and next_match_id is null)
   is distinct from (select winner_entry from tournament_matches where tournament_id = current_setting('t.k')::uuid and tableau_b and next_match_id is null))::text || ' ' ||
  (not exists (select 1 from tournament_matches b, tournament_matches f where b.tournament_id = current_setting('t.k')::uuid and b.tableau_b and f.tournament_id = b.tournament_id and not f.tableau_b and f.next_match_id is null
     and (b.entry_a = (case when f.winner_entry = f.entry_a then f.entry_b else f.entry_a end) or b.entry_b = (case when f.winner_entry = f.entry_a then f.entry_b else f.entry_a end))))::text;
select 'chaque perdant du A (sauf finale) joue dans le B : ' || (select count(distinct e) from (select entry_a e from tournament_matches where tournament_id = current_setting('t.k')::uuid and tableau_b union select entry_b from tournament_matches where tournament_id = current_setting('t.k')::uuid and tableau_b) x where e is not null) || ' joueurs (attendu 6)';
-- 6 joueurs : 2 exemptions au 1er tour du A
select _t(:'T', 'tournoi KO 6 avec tableau B', $$insert into tournaments(name, format, max_participants, status, b_double) values ('KO B6', 'knockout', 16, 'open', true) returning id::text$$);
select set_config('t.s', (select id::text from tournaments where name = 'KO B6'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.s')::uuid, 'S' || i from generate_series(1, 6) i;
select _t(:'T', 'lancer', $$select lancer_tournoi(current_setting('t.s')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}')::text$$);
select 'matchs joués : ' || _jouer_tout(current_setting('t.s')::uuid);
select '6 joueurs : terminé, 4 joueurs passés dans le B (attendu finished 4) → ' || (select status from tournaments where id = current_setting('t.s')::uuid) || ' ' ||
  (select count(distinct e) from (select entry_a e from tournament_matches where tournament_id = current_setting('t.s')::uuid and tableau_b union select entry_b from tournament_matches where tournament_id = current_setting('t.s')::uuid and tableau_b) x where e is not null);
-- 16 joueurs : structure 4,4,2,2,1
select _t(:'T', 'tournoi KO 16', $$insert into tournaments(name, format, max_participants, status, b_double) values ('KO B16', 'knockout', 16, 'open', true) returning id::text$$);
select set_config('t.g', (select id::text from tournaments where name = 'KO B16'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.g')::uuid, 'G' || i from generate_series(1, 16) i;
select _t(:'T', 'lancer', $$select lancer_tournoi(current_setting('t.g')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}')::text$$);
select 'B 16 (attendu 4,4,2,2,1) → ' || (select string_agg(n::text, ',' order by round_no) from (select round_no, count(*) n from tournament_matches where tournament_id = current_setting('t.g')::uuid and tableau_b group by round_no) x);
select 'matchs joués : ' || _jouer_tout(current_setting('t.g')::uuid) || ' (attendu 28)';
select '16 joueurs : statut (attendu finished) → ' || (select status from tournaments where id = current_setting('t.g')::uuid);
-- Sans option : rien ne change
select _t(:'T', 'tournoi KO 4 sans B', $$insert into tournaments(name, format, max_participants, status, third_place) values ('KO 4', 'knockout', 16, 'open', true) returning id::text$$);
insert into tournament_entries(tournament_id, guest_name) select (select id from tournaments where name = 'KO 4'), 'K' || i from generate_series(1, 4) i;
select _t(:'T', 'lancer (3 arguments)', $$select lancer_tournoi((select id from tournaments where name = 'KO 4'), '{"variant":"501","legs_kind":"first_to","legs_n":2}', null)::text$$);
select 'sans B : 4 matchs dont 3e place, aucun B → ' || count(*) || ' ' || count(*) filter (where is_third_place) || ' ' || count(*) filter (where tableau_b) from tournament_matches where tournament_id = (select id from tournaments where name = 'KO 4');
