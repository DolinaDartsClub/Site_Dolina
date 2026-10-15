\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
create temp table ids as select (select id from tournaments where name = 'KO4') as ko4, (select id from tournaments where name = 'Poules6') as poules;
grant select on ids to authenticated;
select 'KO4 : ' || (select count(*) from games g join tournament_matches m on m.id = g.tournament_match_id where m.tournament_id = (select ko4 from ids)) || ' parties, Poules6 : ' || (select count(*) from games g join tournament_matches m on m.id = g.tournament_match_id where m.tournament_id = (select poules from ids)) || ' parties, total parties ' || (select count(*) from games);
select _t(:'W', 'Will (non admin, non organisateur) refusé', $$select supprimer_tournoi((select ko4 from ids))::text$$, 'Seul un administrateur');
select _t(null, 'visiteur refusé', $$select supprimer_tournoi((select ko4 from ids))::text$$, 'Seul un administrateur');
select _t(:'T', 'Tony (admin) supprime KO4 en gardant les parties', $$select supprimer_tournoi((select ko4 from ids), false)::text$$, 'ok');
select case when not exists (select 1 from tournaments where id = (select ko4 from ids)) then 'PASS  KO4 supprimé' else 'FAIL  KO4 encore là' end;
select 'parties restantes : ' || count(*) || ' (aucune ne pointe vers un match supprimé : ' || (select count(*) from games where tournament_match_id is not null and tournament_match_id not in (select id from tournament_matches)) || ')' from games;
select _t(:'T', 'Tony supprime Poules6 avec ses parties', $$select supprimer_tournoi((select poules from ids), true)::text$$, 'ok');
select case when not exists (select 1 from tournaments where id = (select poules from ids)) then 'PASS  Poules6 supprimé' else 'FAIL  Poules6 encore là' end;
select 'parties restantes : ' || count(*) from games;
select _t(:'T', 'tournoi inexistant', $$select supprimer_tournoi((select ko4 from ids))::text$$, 'n''existe pas');
