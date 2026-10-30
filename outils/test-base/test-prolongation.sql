-- Script 067 : prolongation
\set T '11111111-1111-1111-1111-111111111111'
\pset tuples_only on
\pset format unaligned
select 'format gardé (attendu true) → ' || (verifier_format_match('{"variant":"501","legs_kind":"first_to","legs_n":4,"prolongation":true}') ->> 'prolongation');
select 'au meilleur de : pas de prolongation (attendu false) → ' || (verifier_format_match('{"variant":"501","legs_kind":"best_of","legs_n":5,"prolongation":true}') ->> 'prolongation');
select 'sans l''option (attendu false) → ' || (verifier_format_match('{"variant":"501","legs_kind":"first_to","legs_n":4}') ->> 'prolongation');
select _t(:'T', 'ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue P', 'pools', 16, 'open', 2, true) returning id::text$$);
insert into tournament_entries(tournament_id, profile_id) select (select id from tournaments where name = 'Ligue P'), id from profiles where status = 'active';
select _t(:'T', 'lancer premier à 4 avec prolongation', $$select lancer_tournoi((select id from tournaments where name = 'Ligue P'), '{"variant":"501","legs_kind":"first_to","legs_n":4,"prolongation":true}', 1)::text$$);
select _t(:'T', 'lancer un match', $$select lancer_match_tournoi((select id from tournament_matches where tournament_id = (select id from tournaments where name = 'Ligue P') and status = 'ready' order by match_no limit 1))::text$$);
select 'partie créée avec prolongation (attendu 4 true) → ' || legs_n || ' ' || prolongation from games where tournament_match_id is not null order by created_at desc limit 1;
