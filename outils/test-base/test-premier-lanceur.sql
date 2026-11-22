-- Script 079 : doublettes, choix du premier lanceur
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;
insert into games (created_by, variant, start_score, mode, legs_kind, legs_n) values (:'T', '501', 501, 'double', 'first_to', 2);
select null from set_config('t.g', (select id::text from games where created_by = :'T' and mode = 'double' order by created_at desc limit 1), false);
insert into game_sides (game_id, side) select current_setting('t.g')::uuid, s from generate_series(1, 2) s;
insert into game_players (game_id, side, profile_id, throw_order) values
  (current_setting('t.g')::uuid, 1, :'T', 1), (current_setting('t.g')::uuid, 1, :'W', 2),
  (current_setting('t.g')::uuid, 2, :'F', 1);
insert into game_players (game_id, side, guest_name, throw_order) values (current_setting('t.g')::uuid, 2, 'Invité X', 2);
select null from set_config('t.w', (select id::text from game_players where game_id = current_setting('t.g')::uuid and profile_id = :'W'), false);
select null from set_config('t.x', (select id::text from game_players where game_id = current_setting('t.g')::uuid and guest_name = 'Invité X'), false);
select null from set_config('t.f', (select id::text from game_players where game_id = current_setting('t.g')::uuid and profile_id = :'F'), false);
select _t(:'T', 'celui qui tient le score choisit (équipe 1 : Will commence)', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 1::smallint, current_setting('t.w')::uuid)::text, 'ok')$$);
select case when (select string_agg(throw_order::text, ',' order by throw_order) from game_players where game_id = current_setting('t.g')::uuid and side = 1) = '1,2'
  and (select throw_order from game_players where id = current_setting('t.w')::uuid) = 1 then 'PASS  Will passe 1er lanceur, Tony 2e' else 'FAIL  ordre équipe 1' end;
select _t(:'F', 'un joueur de l''équipe 2 choisit pour son équipe', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 2::smallint, current_setting('t.x')::uuid)::text, 'ok')$$);
select _t(:'G', 'hors partie : refusé', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 2::smallint, current_setting('t.f')::uuid)::text, 'ok')$$, 'Seule la personne');
select _t(:'F', 'joueur de l''équipe 2 : ne choisit pas pour l''équipe 1', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 1::smallint, current_setting('t.w')::uuid)::text, 'ok')$$, 'Seule la personne');
select _t(:'T', 'joueur d''une autre équipe : refusé', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 1::smallint, current_setting('t.f')::uuid)::text, 'ok')$$, 'ne fait pas partie');
insert into visits (game_id, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g')::uuid, 1, 1, 1, 60, 501);
select _t(:'T', 'équipe 1 a lancé : plus de changement', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 1::smallint, current_setting('t.w')::uuid)::text, 'ok')$$, 'déjà lancé');
select _t(:'T', 'équipe 2 n''a pas lancé : peut encore changer', $$select coalesce(choisir_premier_lanceur(current_setting('t.g')::uuid, 2::smallint, current_setting('t.f')::uuid)::text, 'ok')$$);
select case when _anon(format('select choisir_premier_lanceur(%L, 2::smallint, %L)::text', current_setting('t.g'), current_setting('t.f'))) like 'ERREUR%' then 'PASS  visiteur sans compte ni lien : refusé' else 'FAIL  visiteur' end;
insert into games (created_by, variant, start_score, mode, legs_kind, legs_n) values (:'T', '501', 501, 'single', 'first_to', 1);
select _t(:'T', 'partie en simple : refusé', $$select coalesce(choisir_premier_lanceur((select id from games where created_by = '11111111-1111-1111-1111-111111111111' and mode = 'single' order by created_at desc limit 1), 1::smallint, current_setting('t.w')::uuid)::text, 'ok')$$, 'seulement en double');
