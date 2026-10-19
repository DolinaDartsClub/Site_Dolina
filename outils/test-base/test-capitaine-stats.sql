-- Espace capitaine (script 037) : retirer un joueur, forme des joueurs
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
-- Will capitaine des Dolinos, pas de vice (le test se suffit à lui-même)
update teams set captain_id = null, vice_captain_id = null;
update teams set captain_id = :'W' where name = 'Dolinos';
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
select id as dolinos from teams where name = 'Dolinos' \gset
select id as d1 from teams where name = 'Dolina 1' \gset
insert into team_members (team_id, profile_id, status) values (:'dolinos', :'F', 'accepted'), (:'dolinos', :'G', 'accepted'), (:'d1', :'G', 'accepted')
  on conflict (team_id, profile_id) do update set status = 'accepted';
update teams set vice_captain_id = :'F' where id = :'dolinos';
select _t(:'G', 'simple joueur : ne retire pas un coéquipier (0 ligne)', format($q$delete from team_members where team_id = %L and profile_id = %L returning 'retiré'$q$, :'dolinos', :'F'));
select case when count(*) = 1 then 'PASS  ' else 'FAIL  ' end || 'Franck toujours dans l''équipe' from team_members where team_id = :'dolinos' and profile_id = :'F';
select _t(:'F', 'vice : ne retire pas le capitaine (0 ligne)', format($q$delete from team_members where team_id = %L and profile_id = %L returning 'retiré'$q$, :'dolinos', :'W'));
select case when count(*) = 1 then 'PASS  ' else 'FAIL  ' end || 'capitaine toujours dans l''équipe' from team_members where team_id = :'dolinos' and profile_id = :'W';
select _t(:'W', 'capitaine : ne retire pas un joueur d''une autre équipe (0 ligne)', format($q$delete from team_members where team_id = %L and profile_id = %L returning 'retiré'$q$, :'d1', :'G'));
select case when count(*) = 1 then 'PASS  ' else 'FAIL  ' end || 'Gérald toujours à Dolina 1' from team_members where team_id = :'d1' and profile_id = :'G';
select _t(:'F', 'vice : retire Gérald des Dolinos', format($q$delete from team_members where team_id = %L and profile_id = %L returning 'retiré'$q$, :'dolinos', :'G'));
select case when count(*) = 0 then 'PASS  ' else 'FAIL  ' end || 'Gérald n''est plus aux Dolinos' from team_members where team_id = :'dolinos' and profile_id = :'G';
select _t(:'W', 'capitaine : retire son vice', format($q$delete from team_members where team_id = %L and profile_id = %L returning 'retiré'$q$, :'dolinos', :'F'));
select case when vice_captain_id is null then 'PASS  ' else 'FAIL  ' end || 'le vice retiré perd son rôle' from teams where id = :'dolinos';
select _t(:'G', 'membre : lit la forme de l''équipe', format($q$select json_array_length(forme_equipe(%L))::text$q$, :'dolinos'));
select _t(null, 'visiteur : refusé', format($q$select forme_equipe(%L)::text$q$, :'dolinos'), 'Réservé');
-- Nettoyage
delete from team_members where profile_id in (:'G') and team_id = :'d1';
update teams set captain_id = null, vice_captain_id = null;
