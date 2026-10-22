-- Script 051 : ajouter un joueur pendant un tournoi en poules
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
\pset tuples_only on
\pset format unaligned
select _t(:'W', 'créer tournoi poules', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Ajout P', 'pools', 16, 'open', 1) returning id::text$$);
select set_config('t.p', (select id::text from tournaments where name = 'Ajout P'), false);
insert into tournament_entries(tournament_id, profile_id) select current_setting('t.p')::uuid, x from unnest(array[:'T', :'F']::uuid[]) x;
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.p')::uuid, 'Inv' || i from generate_series(1, 3) i;
select _t(:'W', 'lancer 2 poules', $$select lancer_tournoi(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 2)::text$$);
select _t(:'W', 'inscription directe refusée', $$insert into tournament_entries(tournament_id, guest_name) values (current_setting('t.p')::uuid, 'Direct') returning id::text$$, 'déjà commencé');
select _t(:'F', 'participant : ajout refusé', $$select ajouter_joueur_en_cours(current_setting('t.p')::uuid, null, 'Nouveau')::text$$, 'Seul l''organisateur');
select set_config('t.avant', (select count(*)::text from tournament_matches where tournament_id = current_setting('t.p')::uuid), false);
select _t(:'W', 'organisateur ajoute Gérald (poule la moins remplie)', $$select ajouter_joueur_en_cours(current_setting('t.p')::uuid, '44444444-4444-4444-4444-444444444444')::text$$);
select _t(:'W', 'Gérald en poule B (2 joueurs) avec 2 matchs à jouer', $$select (1 / ((select pool_no from tournament_entries where tournament_id = current_setting('t.p')::uuid and profile_id = '44444444-4444-4444-4444-444444444444') = 2
  and (select count(*) from tournament_matches m join tournament_entries e on e.id in (m.entry_a, m.entry_b) where m.tournament_id = current_setting('t.p')::uuid and e.profile_id = '44444444-4444-4444-4444-444444444444' and m.status = 'ready' and m.pool_no = 2) = 2)::int)::text$$);
select _t(:'W', 'invité ajouté en poule A choisie', $$select ajouter_joueur_en_cours(current_setting('t.p')::uuid, null, 'Retardataire', 1)::text$$);
select _t(:'W', '3 + 2 matchs créés en plus', $$select (1 / ((select count(*) from tournament_matches where tournament_id = current_setting('t.p')::uuid) = current_setting('t.avant')::int + 5)::int)::text$$);
select _t(:'W', 'doublon refusé', $$select ajouter_joueur_en_cours(current_setting('t.p')::uuid, '44444444-4444-4444-4444-444444444444')::text$$, 'déjà inscrit');
select _t(:'W', 'poule inexistante refusée', $$select ajouter_joueur_en_cours(current_setting('t.p')::uuid, null, 'X', 5)::text$$, 'n''existe pas');
-- Élimination directe : refusé
select _t(:'W', 'créer KO', $$insert into tournaments(name, format, max_participants, status) values ('Ajout KO', 'knockout', 16, 'open') returning id::text$$);
insert into tournament_entries(tournament_id, guest_name) select (select id from tournaments where name = 'Ajout KO'), 'K' || i from generate_series(1, 4) i;
select _t(:'W', 'lancer KO', $$select lancer_tournoi((select id from tournaments where name = 'Ajout KO'), '{"variant":"501","legs_kind":"first_to","legs_n":2}')::text$$);
select _t(:'W', 'KO : ajout refusé', $$select ajouter_joueur_en_cours((select id from tournaments where name = 'Ajout KO'), null, 'Tard')::text$$, 'élimination directe');

delete from tournaments where name in ('Ajout P', 'Ajout KO');
