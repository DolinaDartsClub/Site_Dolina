\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
-- Préparation : tournoi ouvert avec Gérald, partie libre Gérald contre un invité, partie libre Gérald contre Franck
insert into tournaments (id, code, name, format, status, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'ABCDEF', 'Ouvert', 'knockout', 'open', :'T');
insert into tournament_entries (tournament_id, profile_id) values ('aaaaaaaa-0000-0000-0000-000000000001', :'G'), ('aaaaaaaa-0000-0000-0000-000000000001', :'F');
insert into games (id, created_by, variant, start_score, mode, legs_kind, legs_n, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001', :'G', '501', 501, 'single', 'first_to', 1, 'finished'),
  ('bbbbbbbb-0000-0000-0000-000000000002', :'G', '501', 501, 'single', 'first_to', 1, 'finished');
insert into game_sides (game_id, side) values ('bbbbbbbb-0000-0000-0000-000000000001', 1), ('bbbbbbbb-0000-0000-0000-000000000001', 2), ('bbbbbbbb-0000-0000-0000-000000000002', 1), ('bbbbbbbb-0000-0000-0000-000000000002', 2);
insert into game_players (game_id, side, profile_id, guest_name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 1, :'G', null), ('bbbbbbbb-0000-0000-0000-000000000001', 2, null, 'Invité Bob'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 1, :'G', null), ('bbbbbbbb-0000-0000-0000-000000000002', 2, :'F', null);
create temp table avant as select (select count(*) from games where tournament_match_id is not null) as parties_tournoi,
  (select count(*) from game_players gp join games g on g.id = gp.game_id where g.tournament_match_id is not null and gp.profile_id = '44444444-4444-4444-4444-444444444444') as gerald_tournoi,
  (select count(*) from tournament_matches where status = 'done') as matchs_valides;
select 'avant : ' || row_to_json(avant)::text from avant;
grant select on avant to authenticated;
-- Export
select _t(:'G', 'Gérald exporte ses données', $$select json_array_length(mes_donnees()->'parties') || ' parties, ' || json_array_length(mes_donnees()->'tournois_inscrit') || ' tournois, email ' || (mes_donnees()->'compte'->>'email')$$, 'ok');
select _t(null, 'visiteur : export refusé', $$select mes_donnees()::text$$, 'Non connecté');
-- Seul admin
select _t(:'T', 'Tony seul admin ne peut pas supprimer son compte', $$select delete_my_account()::text$$, 'seul administrateur');
select _t(:'F', 'Franck ne peut pas appeler la suppression interne', $$select supprimer_compte('44444444-4444-4444-4444-444444444444')::text$$, 'permission denied');
-- Suppression par Gérald
select _t(:'G', 'Gérald supprime son compte', $$select delete_my_account()::text$$, 'ok');
select case when not exists (select 1 from profiles where id = :'G') then 'PASS  profil effacé' else 'FAIL  profil encore là' end;
select case when not exists (select 1 from games where id = 'bbbbbbbb-0000-0000-0000-000000000001') then 'PASS  partie libre contre invité effacée' else 'FAIL  partie contre invité gardée' end;
select case when (select display_name from game_players where game_id = 'bbbbbbbb-0000-0000-0000-000000000002' and side = 1) = 'Ancien joueur' then 'PASS  partie contre Franck gardée, « Ancien joueur »' else 'FAIL  partie contre Franck' end;
select case when (select count(*) from tournament_entries where tournament_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1 then 'PASS  inscription au tournoi ouvert retirée (Franck reste)' else 'FAIL  tournoi ouvert' end;
select case when (select count(*) from games where tournament_match_id is not null) = (select parties_tournoi from avant) then 'PASS  matchs de tournoi tous gardés (' || (select parties_tournoi from avant) || ')' else 'FAIL  matchs de tournoi effacés' end;
select case when (select count(*) from tournament_matches where status = 'done') = (select matchs_valides from avant) then 'PASS  résultats validés intacts' else 'FAIL  résultats modifiés' end;
select case when (select count(*) from game_players gp join games g on g.id = gp.game_id where g.tournament_match_id is not null and gp.display_name = 'Ancien joueur') >= (select gerald_tournoi from avant) then 'PASS  Gérald = « Ancien joueur » dans les matchs de tournoi' else 'FAIL  nom dans les tournois' end;
select case when (select count(*) from tournament_entries e join tournaments t on t.id = e.tournament_id where t.name = 'KO4') = 4 then 'PASS  tableau KO4 complet (4 inscrits)' else 'FAIL  KO4' end;
select _t(:'T', 'stats du tournoi KO4 toujours calculées', $$select json_array_length(stats_tournoi((select id from tournaments where name = 'KO4'))->'joueurs')::text$$, 'ok');
select _t(:'T', 'détail du tournoi KO4 : « Ancien joueur »', $$select (tournoi_detail((select id from tournaments where name = 'KO4'))::text like '%Ancien joueur%')::text$$, 'ok');
-- Suppression par l'admin
select _t(:'F', 'Franck ne peut pas supprimer un autre compte', $$select admin_delete_account('11111111-1111-1111-1111-111111111111')::text$$, 'Réservé aux administrateurs');
select _t(:'T', 'Tony (admin) supprime le compte de Franck', $$select admin_delete_account('33333333-3333-3333-3333-333333333333')::text$$, 'ok');
select case when not exists (select 1 from auth.users where id = :'F') then 'PASS  compte de Franck effacé' else 'FAIL  Franck encore là' end;
select case when (select count(*) from games where tournament_match_id is not null) = (select parties_tournoi from avant) then 'PASS  matchs de tournoi toujours gardés' else 'FAIL  matchs de tournoi effacés' end;
