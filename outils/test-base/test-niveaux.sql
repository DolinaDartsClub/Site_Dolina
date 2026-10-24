-- Script 060 : niveaux des joueurs et poules équilibrées
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\pset tuples_only on
\pset format unaligned
select _t(:'W', 'membre : pas de niveau', $$select definir_niveau_joueur('22222222-2222-2222-2222-222222222222', 1)::text$$, 'Seul un admin');
select _t(:'W', 'membre : niveaux illisibles', $$select count(*)::text from niveaux_joueurs$$);
select _t(:'T', 'admin : Will niveau 1', $$select definir_niveau_joueur('22222222-2222-2222-2222-222222222222', 1)::text$$);
select _t(:'T', 'admin : Franck niveau 1', $$select definir_niveau_joueur('33333333-3333-3333-3333-333333333333', 1)::text$$);
select _t(:'T', 'niveau 7 refusé', $$select definir_niveau_joueur('44444444-4444-4444-4444-444444444444', 7)::text$$, 'entre 1');
-- Tournoi de 12 : 4 joueurs de niveau 1 (2 membres + 2 invités notés), 4 de niveau 2, 4 sans niveau → 2 poules
select _t(:'T', 'tournoi 2 poules', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Equilibre', 'pools', 16, 'open', 2) returning id::text$$);
select set_config('t.t', (select id::text from tournaments where name = 'Equilibre'), false);
insert into tournament_entries(tournament_id, profile_id) values (current_setting('t.t')::uuid, '22222222-2222-2222-2222-222222222222'), (current_setting('t.t')::uuid, '33333333-3333-3333-3333-333333333333');
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.t')::uuid, 'G' || i from generate_series(1, 10) i;
select _t(:'W', 'non organisateur : niveaux refusés', $$select count(*)::text from niveaux_tournoi(current_setting('t.t')::uuid)$$, 'Seul l''organisateur');
do $$ declare e record; begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  for e in select id, guest_name from tournament_entries where tournament_id = current_setting('t.t')::uuid and guest_name is not null loop
    if e.guest_name in ('G1', 'G2') then perform definir_niveau_inscrit(e.id, 1);
    elsif e.guest_name in ('G3', 'G4', 'G5', 'G6') then perform definir_niveau_inscrit(e.id, 2); end if;
  end loop; end $$;
select _t(:'T', 'niveaux : 4 de niveau 1 (dont 2 membres)', $$select count(*) filter (where niveau = 1) || ' / propres ' || count(*) filter (where propre) from niveaux_tournoi(current_setting('t.t')::uuid)$$);
select _t(:'T', 'lancer en 2 poules', $$select lancer_tournoi(current_setting('t.t')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 2)::text$$);
select 'poules (attendu 1:2-2-2 2:2-2-2) → ' || (select string_agg(pool_no || ':' || n1 || '-' || n2 || '-' || n0, ' ' order by pool_no) from (
  select pool_no, count(*) filter (where niveau_inscrit(id) = 1) n1, count(*) filter (where niveau_inscrit(id) = 2) n2, count(*) filter (where niveau_inscrit(id) is null) n0
  from tournament_entries where tournament_id = current_setting('t.t')::uuid group by pool_no) x);
-- 3 poules, 9 joueurs tous notés 1..9 → serpentin
select _t(:'T', 'tournoi 3 poules', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Serpentin', 'pools', 16, 'open', 1) returning id::text$$);
select set_config('t.s', (select id::text from tournaments where name = 'Serpentin'), false);
insert into tournament_entries(tournament_id, guest_name) select current_setting('t.s')::uuid, 'S' || i from generate_series(1, 9) i;
do $$ declare e record; begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  for e in select id, substr(guest_name, 2)::int k from tournament_entries where tournament_id = current_setting('t.s')::uuid loop
    perform definir_niveau_inscrit(e.id, least(5, (e.k + 2) / 3));   -- S1-S3 : 1, S4-S6 : 2, S7-S9 : 3
  end loop; end $$;
select _t(:'T', 'lancer en 3 poules', $$select lancer_tournoi(current_setting('t.s')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 3)::text$$);
select 'serpentin (attendu 1:123 2:123 3:123) → ' || (select string_agg(pool_no || ':' || niveaux, ' ' order by pool_no) from (
  select pool_no, string_agg(niveau_inscrit(id)::text, '' order by niveau_inscrit(id)) niveaux from tournament_entries where tournament_id = current_setting('t.s')::uuid group by pool_no) x);
