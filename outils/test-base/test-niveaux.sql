-- Scripts 060 à 063 : niveaux donnés par l'admin, utilisés pour la ligue interne seulement
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\pset tuples_only on
\pset format unaligned
select _t(:'W', 'membre : pas de niveau', $$select definir_niveau_joueur('22222222-2222-2222-2222-222222222222', 1)::text$$, 'Seul un admin');
select _t(:'W', 'membre : niveaux illisibles', $$select count(*)::text from niveaux_joueurs$$);
select _t(:'T', 'admin : Will 1', $$select definir_niveau_joueur('22222222-2222-2222-2222-222222222222', 1)::text$$);
select _t(:'T', 'admin : Franck 1', $$select definir_niveau_joueur('33333333-3333-3333-3333-333333333333', 1)::text$$);
select _t(:'T', 'admin : Tony 2', $$select definir_niveau_joueur('11111111-1111-1111-1111-111111111111', 2)::text$$);
select _t(:'T', 'admin : Gérald 2', $$select definir_niveau_joueur('44444444-4444-4444-4444-444444444444', 2)::text$$);
select _t(:'T', 'niveau 7 refusé', $$select definir_niveau_joueur('44444444-4444-4444-4444-444444444444', 7)::text$$, 'entre 1');
select _t(:'T', 'plus de niveau par tournoi', $$select definir_niveau_inscrit(gen_random_uuid(), 1)::text$$, 'does not exist');
-- Ligue de 6 en 2 poules : chaque poule a un niveau 1, un niveau 2 et un invité sans niveau
select _t(:'T', 'ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue) values ('Ligue niv', 'pools', 16, 'open', 1, true) returning id::text$$);
select set_config('t.l', (select id::text from tournaments where name = 'Ligue niv'), false);
insert into tournament_entries(tournament_id, profile_id) select current_setting('t.l')::uuid, id from profiles where status = 'active';
insert into tournament_entries(tournament_id, guest_name) values (current_setting('t.l')::uuid, 'Inv 1'), (current_setting('t.l')::uuid, 'Inv 2');
select _t(:'W', 'inscrit : niveaux refusés', $$select count(*)::text from niveaux_tournoi(current_setting('t.l')::uuid)$$, 'Seul un admin');
select _t(:'T', 'admin : niveaux de la ligue (lecture)', $$select string_agg(coalesce(niveau::text, '-'), '' order by niveau nulls last) from niveaux_tournoi(current_setting('t.l')::uuid)$$);
select _t(:'T', 'lancer en 2 poules', $$select lancer_tournoi(current_setting('t.l')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":3}', 2)::text$$);
select 'ligue équilibrée (attendu 1:12- 2:12-) → ' || (select string_agg(pool_no || ':' || n, ' ' order by pool_no) from (
  select pool_no, string_agg(coalesce(niveau_inscrit(id)::text, '-'), '' order by niveau_inscrit(id) nulls last) n
  from tournament_entries where tournament_id = current_setting('t.l')::uuid group by pool_no) x);
-- Tournoi normal créé par un membre : l'organisateur ne voit aucun niveau
select _t(:'W', 'tournoi de Will', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('De Will', 'pools', 16, 'open', 1) returning id::text$$);
select set_config('t.w', (select id::text from tournaments where name = 'De Will'), false);
select _t(:'W', 'organisateur membre : aucun niveau', $$select count(*)::text from niveaux_tournoi(current_setting('t.w')::uuid)$$, 'Seul un admin');
select _t(:'T', 'admin : rien pour un tournoi normal', $$select count(*)::text from niveaux_tournoi(current_setting('t.w')::uuid)$$);
