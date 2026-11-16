-- Script 076 : la ligue interne visible par les capitaines (lecture seule)
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
update teams set captain_id = :'W', vice_captain_id = null where name = 'Dolina 2';
update teams set captain_id = null, vice_captain_id = null where name <> 'Dolina 2' and :'F' in (captain_id, vice_captain_id);
select _t(:'T', 'ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue, public_matches) values ('Ligue C', 'pools', 16, 'open', 2, true, false) returning id::text$$);
-- Inscrits : tous les membres actifs sauf Will (capitaine) et Franck
insert into tournament_entries(tournament_id, profile_id) select t.id, p.id from tournaments t, profiles p
  where t.name = 'Ligue C' and p.status = 'active' and p.id not in (:'W', :'F');
insert into tournament_entries(tournament_id, guest_name) select id, 'Invité Ligue' from tournaments where name = 'Ligue C';
select _t(:'T', 'lancer', $$select lancer_tournoi((select id from tournaments where name = 'Ligue C'), '{"variant":"501","legs_kind":"first_to","legs_n":1}', 1)::text$$);
select null from set_config('t.l', (select id::text from tournaments where name = 'Ligue C'), false);
select _t(:'W', 'ligue pas encore ouverte : capitaine refusé', $$select tournoi_detail(current_setting('t.l')::uuid) ->> 'role'$$, 'pas encore ouverte');
select _t(:'T', 'ligue ouverte aux membres', $$update tournaments set ligue_visible = true where id = current_setting('t.l')::uuid returning 'ok'$$);
select _t(:'W', 'capitaine non inscrit : voit la ligue en spectateur', $$select tournoi_detail(current_setting('t.l')::uuid) ->> 'role'$$);
select _t(:'W', 'capitaine : pas le code de la ligue', $$select coalesce(tournoi_detail(current_setting('t.l')::uuid) -> 'tournoi' ->> 'code', 'caché')$$);
select _t(:'W', 'capitaine : récap du scoring', $$select json_array_length(stats_tournoi(current_setting('t.l')::uuid))::text$$);
select _t(:'W', 'capitaine : lit les matchs', $$select (count(*) > 0)::text from tournament_matches where tournament_id = current_setting('t.l')::uuid$$);
select _t(:'W', 'capitaine : lit les inscrits', $$select (count(*) > 0)::text from tournament_entries where tournament_id = current_setting('t.l')::uuid$$);
select _t(:'W', 'capitaine : la ligue apparaît dans les tournois', $$select count(*)::text from tournaments where id = current_setting('t.l')::uuid$$);
select _t(:'W', 'capitaine : ne lance pas de match', $$select lancer_match_tournoi((select id from tournament_matches where tournament_id = current_setting('t.l')::uuid and status = 'ready' limit 1))::text$$, 'participants');
select _t(:'F', 'membre non capitaine, non inscrit : refusé', $$select tournoi_detail(current_setting('t.l')::uuid) ->> 'role'$$, 'réservé');
select _t(:'F', 'membre non capitaine : pas de scoring', $$select stats_tournoi(current_setting('t.l')::uuid)::text$$, 'réservé');
select _t(:'F', 'membre non capitaine : aucun match', $$select count(*)::text from tournament_matches where tournament_id = current_setting('t.l')::uuid$$);
-- Un tournoi ordinaire privé reste fermé aux capitaines
insert into tournaments(name, format, max_participants, status, public_matches, created_by) values ('Privé C', 'knockout', 16, 'running', false, :'T');
select null from set_config('t.p', (select id::text from tournaments where name = 'Privé C'), false);
select _t(:'W', 'tournoi ordinaire privé : capitaine refusé', $$select tournoi_detail(current_setting('t.p')::uuid) ->> 'role'$$, 'réservé');
