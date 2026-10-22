-- Script 054 : rattacher un invité à un compte
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set P '55555555-5555-5555-5555-555555555555'
\pset tuples_only on
\pset format unaligned
-- Paul (pas encore validé) a joué comme invité « Paul Attente » : un tournoi et une partie libre
select _t(:'W', 'tournoi avec l invité', $$insert into tournaments(name, format, max_participants, status) values ('Ratt KO', 'knockout', 8, 'open') returning id::text$$);
select set_config('t.k', (select id::text from tournaments where name = 'Ratt KO'), false);
insert into tournament_entries(tournament_id, guest_name) values (current_setting('t.k')::uuid, 'Paul Attente'), (current_setting('t.k')::uuid, 'Autre');
insert into tournament_entries(tournament_id, profile_id) values (current_setting('t.k')::uuid, :'F');
insert into tournament_entries(tournament_id, guest_name) values (current_setting('t.k')::uuid, 'Encore');
select _t(:'W', 'lancer', $$select lancer_tournoi(current_setting('t.k')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":1}')::text$$);
do $$ declare m record; g uuid; begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  for m in select tm.* from tournament_matches tm join tournament_entries e on e.id in (tm.entry_a, tm.entry_b) where tm.tournament_id = current_setting('t.k')::uuid and e.guest_name = 'Paul Attente' and tm.status = 'ready' loop
    g := lancer_match_tournoi(m.id);
    insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (g, 1, 1, 1, 1, 40, 40, true, 2, 1);
    update games set status = 'finished', winner_side = 1, finished_at = now() where id = g; perform valider_match_tournoi(g);
  end loop; end $$;
-- Partie libre de Will contre l'invité
insert into games(id, created_by, variant, start_score, mode, legs_kind, legs_n, visibility, status, winner_side, finished_at) values ('eeeeeeee-0000-0000-0000-000000000001', :'W', '501', 501, 'single', 'first_to', 1, 'public', 'live', null, null);
insert into game_sides(game_id, side) values ('eeeeeeee-0000-0000-0000-000000000001', 1), ('eeeeeeee-0000-0000-0000-000000000001', 2);
insert into game_players(game_id, side, profile_id, throw_order) values ('eeeeeeee-0000-0000-0000-000000000001', 1, :'W', 1);
insert into game_players(game_id, side, guest_name, throw_order) values ('eeeeeeee-0000-0000-0000-000000000001', 2, 'Paul A.', 1);
update games set status = 'finished', winner_side = 2, finished_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000001';

select _t(:'W', 'non admin : refusé', $$select invites_correspondants('55555555-5555-5555-5555-555555555555')::text$$, 'Réservé aux administrateurs');
select _t(:'T', 'admin : correspondances trouvées (Paul)', $$select (1 / ((select json_array_length(r->'inscriptions') = 1 and json_array_length(r->'parties') = 1 and (r->'inscriptions'->0->>'parties')::int >= 1 from invites_correspondants('55555555-5555-5555-5555-555555555555') r))::int)::text$$);
select set_config('t.e', (select id::text from tournament_entries where tournament_id = current_setting('t.k')::uuid and guest_name = 'Paul Attente'), false);
select set_config('t.gp', (select id::text from game_players where game_id = 'eeeeeeee-0000-0000-0000-000000000001' and side = 2), false);
select _t(:'T', 'rattacher inscription + partie libre', $$select rattacher_invite('55555555-5555-5555-5555-555555555555', array[current_setting('t.e')::uuid], array[current_setting('t.gp')::uuid])::text$$);
select _t(:'T', 'inscription et parties au nom de Paul', $$select (1 / ((select profile_id = '55555555-5555-5555-5555-555555555555' and guest_name is null from tournament_entries where id = current_setting('t.e')::uuid)
  and not exists (select 1 from game_players where guest_name like 'Paul%')
  and (select count(*) from game_players where profile_id = '55555555-5555-5555-5555-555555555555') >= 2)::int)::text$$);
-- Déjà inscrit : Franck ne peut pas récupérer « Autre » du même tournoi
select set_config('t.autre', (select id::text from tournament_entries where tournament_id = current_setting('t.k')::uuid and guest_name = 'Autre'), false);
select _t(:'T', 'déjà inscrit dans ce tournoi : refusé', $$select rattacher_invite('33333333-3333-3333-3333-333333333333', array[current_setting('t.autre')::uuid])::text$$, 'déjà inscrit');
-- Annulation
select _t(:'T', 'liste des rattachements (inscription + partie libre)', $$select (1 / ((select json_array_length(r->'rattaches') from invites_correspondants('55555555-5555-5555-5555-555555555555') r) = 2)::int)::text$$);
select _t(:'T', 'tout annuler', $$select annuler_rattachements((select array_agg(id) from rattachements_invites where profile_id = '55555555-5555-5555-5555-555555555555'))::text$$);
select _t(:'T', 'invité retrouvé partout', $$select (1 / ((select guest_name = 'Paul Attente' and profile_id is null from tournament_entries where id = current_setting('t.e')::uuid)
  and (select guest_name from game_players where id = current_setting('t.gp')::uuid) = 'Paul A.'
  and not exists (select 1 from game_players where profile_id = '55555555-5555-5555-5555-555555555555')
  and not exists (select 1 from rattachements_invites where profile_id = '55555555-5555-5555-5555-555555555555'))::int)::text$$);

delete from games where id = 'eeeeeeee-0000-0000-0000-000000000001';
delete from tournaments where name = 'Ratt KO';
