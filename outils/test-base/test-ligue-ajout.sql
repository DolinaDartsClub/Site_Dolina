-- Script 059 : ajouter un membre à une ligue complète déjà lancée
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\pset tuples_only on
\pset format unaligned
select _t(:'T', 'ligue de 4 places', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue pleine', 'pools', 4, 'open', 2, true) returning id::text$$);
select set_config('t.l', (select id::text from tournaments where name = 'Ligue pleine'), false);
select _t(:'T', '4 inscrits (complet)', $$with i as (insert into tournament_entries(tournament_id, profile_id) values (current_setting('t.l')::uuid, '11111111-1111-1111-1111-111111111111'), (current_setting('t.l')::uuid, '22222222-2222-2222-2222-222222222222'), (current_setting('t.l')::uuid, '33333333-3333-3333-3333-333333333333'), (current_setting('t.l')::uuid, '44444444-4444-4444-4444-444444444444') returning 1) select count(*)::text from i$$);
select _t(:'T', 'lancer', $$select lancer_tournoi(current_setting('t.l')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":3}', 1)::text$$);
select _t(:'W', 'membre : ajout refusé', $$select ajouter_joueur_en_cours(current_setting('t.l')::uuid, null, 'Nouveau')::text$$, 'Seul l''organisateur');
select _t(:'T', 'admin : ajoute un membre à la ligue pleine', $$select ajouter_joueur_en_cours(current_setting('t.l')::uuid, null, 'Nouveau membre')::text$$);
select _t(:'T', 'places : 5, inscrits : 5', $$select max_participants || ' ' || (select count(*) from tournament_entries e where e.tournament_id = t.id) from tournaments t where id = current_setting('t.l')::uuid$$);
select _t(:'T', '4 nouveaux matchs pour lui', $$select count(*)::text from tournament_matches m join tournament_entries e on e.id = m.entry_b where m.tournament_id = current_setting('t.l')::uuid and e.guest_name = 'Nouveau membre'$$);
select _t(:'T', 'un deuxième', $$select ajouter_joueur_en_cours(current_setting('t.l')::uuid, null, 'Encore un')::text$$);
select _t(:'T', 'places : 6, 15 matchs au total', $$select max_participants || ' ' || (select count(*) from tournament_matches m where m.tournament_id = t.id) from tournaments t where id = current_setting('t.l')::uuid$$);
-- Un tournoi normal complet reste complet
select _t(:'T', 'tournoi normal de 3 places', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Tournoi plein', 'pools', 3, 'open', 2) returning id::text$$);
select set_config('t.n', (select id::text from tournaments where name = 'Tournoi plein'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.n')::uuid, 'J' || i from generate_series(1, 3) i;
select _t(:'T', 'lancer le tournoi', $$select lancer_tournoi(current_setting('t.n')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 1)::text$$);
select _t(:'T', 'tournoi normal complet : ajout refusé', $$select ajouter_joueur_en_cours(current_setting('t.n')::uuid, null, 'Retard')::text$$, 'complet');
