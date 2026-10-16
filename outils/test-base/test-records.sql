\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\pset tuples_only on
\pset format unaligned
-- Fabrique d'une partie : camps (profil ou invité), volées « camp:score[:fin fléchettes:double] » par manche
create or replace function _partie(variant text, joueurs text[], statut text, gagnant int, manches text[], mode text default 'single', quand timestamptz default now())
returns uuid language plpgsql as $$
declare g uuid; i int; m int; v text; parts text[]; reste int[]; no int[]; c int; sc int; depart int;
begin
  depart := case variant when '301' then 301 when '501' then 501 else 701 end;
  insert into games(created_by, variant, start_score, mode, legs_kind, legs_n, status, winner_side, finished_at)
  values ('11111111-1111-1111-1111-111111111111', variant, depart, mode, 'first_to', 2, statut, gagnant, quand) returning id into g;
  for i in 1..array_length(joueurs, 1) loop
    insert into game_sides(game_id, side) values (g, i);
    if joueurs[i] ~ '^[0-9a-f-]{36}$' then insert into game_players(game_id, side, profile_id) values (g, i, joueurs[i]::uuid);
    else insert into game_players(game_id, side, guest_name) values (g, i, joueurs[i]); end if;
  end loop;
  for m in 1..coalesce(array_length(manches, 1), 0) loop
    reste := array_fill(depart, array[4]); no := array_fill(0, array[4]);
    foreach v in array string_to_array(manches[m], ' ') loop
      parts := string_to_array(v, ':'); c := parts[1]::int; sc := parts[2]::int; no[c] := no[c] + 1;
      insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double)
      values (g, 1, m, no[c], c, sc, reste[c], coalesce(parts[3], '') = 'b', array_length(parts, 1) >= 4,
              case when array_length(parts, 1) >= 4 then parts[4]::int else 3 end,
              case when array_length(parts, 1) >= 5 then parts[5]::int else 0 end);
      if coalesce(parts[3], '') <> 'b' then reste[c] := reste[c] - sc; end if;
    end loop;
  end loop;
  return g;
end $$;
alter table games disable trigger user;
create or replace function _egal(uid text, label text, q text, attendu text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  execute q into r;
  execute 'reset role';
  return case when r = attendu then 'PASS  ' || label || '  → ' || r else 'FAIL  ' || label || '  attendu: ' || attendu || '  obtenu: ' || r end;
end $f$;
\set F '33333333-3333-3333-3333-333333333333'
\set P '55555555-5555-5555-5555-555555555555'
-- Tony bat Will (Tony : moyenne 119,2 ; finish 141)
select _partie('501', array[:'T', :'W'], 'finished', 1, array[
  '1:100 2:60 1:140 2:60 1:180 2:60 1:81:f:3:1',
  '2:180 1:45 2:180 1:26 2:141:f:3:1',
  '1:180 2:100 1:180 2:100 1:141:f:3:1']) is not null;
-- Will bat Franck en 301 : Will finit 161
select _partie('301', array[:'W', :'F'], 'finished', 1, array['1:140 2:60 1:100 2:60 1:61:f:3:1']) is not null;
-- Ne comptent pas : amical, solo, contre invité (compte !), saison passée, < 9 fléchettes
select _partie('501', array[:'F', :'T'], 'finished', 1, array['1:180 2:60 1:151 2:60 1:170:f:3:1']) as gid \gset
update games set match_type = 'amical' where id = :'gid';
select _partie('501', array[:'T'], 'finished', 1, array['1:180 1:151 1:170:f:3:1']) is not null;
select _partie('501', array[:'T', 'X', :'W', 'Y'], 'finished', 1, array['1:180 3:60 2:60 4:60 1:160:f:3:1'], 'double') is not null;
select _partie('501', array[:'F', 'Bot'], 'finished', 1, array['1:180 2:60 1:151 2:60 1:170:f:3:1']) as gid \gset
update games set mode = 'bot' where id = :'gid';
select _partie('501', array[:'F', :'W'], 'finished', 1, array['1:180 2:20 1:180 2:20 1:141:f:3:1'], 'single', '2025-03-01') is not null;
select _partie('501', array[:'F', :'W'], 'finished', 2, array['1:100 2:180 1:100 2:180 2:141:f:3:1']) is not null;
select _egal(:'T', 'moyennes depuis toujours : un par joueur, à égalité le plus ancien d''abord', $$
  select string_agg((x->>'nom') || '=' || (x->>'moyenne'), ' ' order by o) from json_array_elements(records_club()->'moyennes') with ordinality t(x, o)$$,
  'Franck Petit=167.00 Will Martin=167.00 Big Tonz=119.22');
select _egal(:'T', 'finishs : amical, solo, 2v2 et dartbot exclus', $$
  select string_agg((x->>'nom') || '=' || (x->>'finish'), ' ' order by o) from json_array_elements(records_club()->'finishs') with ordinality t(x, o)$$,
  'Franck Petit=141 Big Tonz=141 Will Martin=141');
select _egal(:'T', 'saison en cours : Franck sans moyenne (moins de 9 fléchettes)', $$
  select string_agg((x->>'nom') || '=' || (x->>'moyenne'), ' ' order by o) from json_array_elements(records_club('2026-09-01', null)->'moyennes') with ordinality t(x, o)$$,
  'Will Martin=167.00 Big Tonz=119.22');
select _egal(:'T', 'filtre 301 : finish de Will', $$ select (records_club(null, null, '301')->'finishs'->0->>'nom') || '=' || (records_club(null, null, '301')->'finishs'->0->>'finish') $$, 'Will Martin=61');
select _egal(:'T', 'adversaire indiqué', $$ select records_club('2026-09-01', null)->'moyennes'->1->>'adversaires' $$, 'Will Martin');
select _egal(:'T', 'période 2025 : la partie de mars 2025', $$ select records_club('2025-01-01', '2025-09-01')->'moyennes'->0->>'moyenne' $$, '167.00');
select _t(:'P', 'compte en attente : refusé', $$ select records_club()::text $$, 'réservés aux membres');
select _t(null, 'visiteur : refusé', $$ select records_club()::text $$, 'réservés aux membres');
