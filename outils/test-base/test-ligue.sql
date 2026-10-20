-- Script 044 : ligue interne (masquée tant que l'admin ne l'ouvre pas)
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
\pset tuples_only on
\pset format unaligned
select _t(:'W', 'membre : créer une ligue refusé', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue W', 'pools', 64, 'open', 4, true) returning id::text$$, 'Seul un admin');
select _t(:'T', 'admin : créer la ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue, cibles_par_poule) values ('Ligue test', 'knockout', 64, 'open', 4, true, 8) returning id::text$$);
select set_config('t.l', (select id::text from tournaments where name = 'Ligue test'), false);
select _t(:'T', 'ligue : format poules, 1 tableau, masquée', $$select (1 / ((select format = 'pools' and pools_count = 1 and not ligue_visible from tournaments where id = current_setting('t.l')::uuid))::int)::text$$);
select _t(:'T', 'admin inscrit des membres et invités', $$with i as (insert into tournament_entries(tournament_id, profile_id) values (current_setting('t.l')::uuid, '22222222-2222-2222-2222-222222222222'), (current_setting('t.l')::uuid, '33333333-3333-3333-3333-333333333333'), (current_setting('t.l')::uuid, '44444444-4444-4444-4444-444444444444'), (current_setting('t.l')::uuid, '11111111-1111-1111-1111-111111111111') returning 1) select count(*)::text from i$$);
select _t(:'T', '+ 2 invités', $$with i as (insert into tournament_entries(tournament_id, guest_name) values (current_setting('t.l')::uuid, 'Inv A'), (current_setting('t.l')::uuid, 'Inv B') returning 1) select count(*)::text from i$$);
select set_config('t.code', (select code from tournaments where id = current_setting('t.l')::uuid), false);
-- Masquée : un inscrit ne la voit nulle part
select _t(:'W', 'inscrit : ligue absente de ses tournois', $$select (1 / ((select count(*) from tournaments where id = current_setting('t.l')::uuid) = 0)::int)::text$$);
select _t(:'W', 'inscrit : détail refusé', $$select tournoi_detail(current_setting('t.l')::uuid)::text$$, 'réservé à ses participants');
select _t(:'W', 'code : introuvable', $$select apercu_tournoi(current_setting('t.code'))::text$$, 'Aucun tournoi ne correspond');
select _t(:'W', 'accueil : absente', $$select (1 / ((select count(*) from tournois_en_cours() where id = current_setting('t.l')::uuid) = 0)::int)::text$$);
select _t(null, 'visiteur accueil : absente', $$select (1 / ((select count(*) from tournois_en_cours() where id = current_setting('t.l')::uuid) = 0)::int)::text$$);
select _t(:'W', 'inscrit : changer la visibilité refusé', $$select definir_visibilite_ligue(current_setting('t.l')::uuid, true)::text$$, 'Seul un admin');
select _t(:'W', 'inscrit : update direct refusé', $$update tournaments set ligue_visible = true where id = current_setting('t.l')::uuid returning id::text$$);
select _t(:'T', 'toujours masquée après la tentative', $$select (1 / ((select not ligue_visible from tournaments where id = current_setting('t.l')::uuid))::int)::text$$);
select _t(:'T', 'admin : voit la ligue (organisateur)', $$select (1 / ((tournoi_detail(current_setting('t.l')::uuid)->>'role') = 'organisateur' and (tournoi_detail(current_setting('t.l')::uuid)->'tournoi'->>'est_ligue') = 'true')::int)::text$$);
-- Lancement : un seul tableau, chacun contre chacun (6 joueurs → 15 matchs)
select _t(:'T', 'lancer la ligue (1 tableau)', $$select lancer_tournoi(current_setting('t.l')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":3}', 1)::text$$);
select _t(:'T', '15 matchs, chacun une fois contre chacun', $$select (1 / ((select count(*) from tournament_matches where tournament_id = current_setting('t.l')::uuid and phase = 'pool') = 15
  and not exists (select 1 from tournament_matches a join tournament_matches b on a.tournament_id = b.tournament_id and a.id < b.id and least(a.entry_a, a.entry_b) = least(b.entry_a, b.entry_b) and greatest(a.entry_a, a.entry_b) = greatest(b.entry_a, b.entry_b) where a.tournament_id = current_setting('t.l')::uuid))::int)::text$$);
select set_config('t.mw', (select m.id::text from tournament_matches m join tournament_entries e on e.id in (m.entry_a, m.entry_b) where m.tournament_id = current_setting('t.l')::uuid and m.status = 'ready' and e.profile_id = :'W' limit 1), false);
select _t(:'W', 'masquée : l inscrit ne peut pas lancer son match', $$select lancer_match_tournoi(current_setting('t.mw')::uuid)::text$$, 'Seuls les participants');
-- Qualifiés pour le Master
select _t(:'W', 'qualifiés : réservé à l organisateur', $$select definir_qualifies(current_setting('t.l')::uuid, 2)::text$$, 'Seul l''organisateur');
select _t(:'T', 'qualifiés : 7 pour 6 joueurs refusé', $$select definir_qualifies(current_setting('t.l')::uuid, 7)::text$$, 'impossible');
select _t(:'T', 'qualifiés : 6', $$select definir_qualifies(current_setting('t.l')::uuid, 6)::text$$);
-- Ouverture aux membres
select _t(:'T', 'admin : rendre visible', $$select definir_visibilite_ligue(current_setting('t.l')::uuid, true)::text$$);
select _t(:'W', 'visible : l inscrit voit la ligue', $$select (1 / ((tournoi_detail(current_setting('t.l')::uuid)->>'role') = 'participant')::int)::text$$);
select _t(:'W', 'visible : l inscrit lance son match', $$select lancer_match_tournoi((select m.id from tournament_matches m join tournament_entries e on e.id in (m.entry_a, m.entry_b) where m.tournament_id = current_setting('t.l')::uuid and m.status = 'ready' and e.profile_id = '22222222-2222-2222-2222-222222222222' limit 1))::text$$);
select _t(:'W', 'visible : retrouvée avec le code', $$select (1 / ((apercu_tournoi(current_setting('t.code'))->>'est_ligue') = 'true')::int)::text$$);
-- Un tournoi normal ne peut pas être marqué visible/ligue par un membre
select _t(:'W', 'tournoi normal : ligue_visible ignoré', $$insert into tournaments(name, format, max_participants, status, ligue_visible) values ('Normal W', 'knockout', 8, 'open', true) returning (1 / (not ligue_visible)::int)::text$$);

delete from tournaments where name in ('Ligue test', 'Normal W');
