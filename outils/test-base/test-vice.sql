-- Vice-capitaine (script 036) : choisi par l'admin ou le capitaine, mêmes accès que le capitaine
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
select id as dolinos from teams where name = 'Dolinos' \gset
select id as d1 from teams where name = 'Dolina 1' \gset
insert into team_members (team_id, profile_id, status) values (:'dolinos', :'F', 'accepted') on conflict (team_id, profile_id) do update set status = 'accepted';
select _t(:'G', 'simple membre : ne choisit pas de vice', format($q$select definir_vice_capitaine(%L, %L)::text$q$, :'dolinos', :'G'), 'Seuls un admin');
select _t(:'W', 'capitaine : refusé pour un joueur hors équipe', format($q$select definir_vice_capitaine(%L, %L)::text$q$, :'dolinos', :'G'), 'joueur de l''équipe');
select _t(:'W', 'capitaine : ne peut pas être son propre vice', format($q$select definir_vice_capitaine(%L, %L)::text$q$, :'dolinos', :'W'), 'pas être aussi');
select _t(:'W', 'capitaine : choisit Franck (joueur de l''équipe)', format($q$select definir_vice_capitaine(%L, %L)::text$q$, :'dolinos', :'F'));
select case when vice_captain_id = :'F' then 'PASS  ' else 'FAIL  ' end || 'Franck est vice-capitaine' from teams where id = :'dolinos';
select _t(:'F', 'vice : saisit une rencontre de son équipe', format($q$insert into rencontres (team_id, date_match, adversaire) values (%L, '2026-12-01', 'Test Vice') returning adversaire$q$, :'dolinos'));
select _t(:'F', 'vice : refusé pour une autre équipe', format($q$insert into rencontres (team_id, date_match, adversaire) values (%L, '2026-12-01', 'X') returning id$q$, :'d1'), 'row-level security');
select _t(:'G', 'Gérald demande à rejoindre les Dolinos', format($q$with d as (insert into team_members (team_id, profile_id) values (%L, %L)) select 'demande envoyée'$q$, :'dolinos', :'G'));
select _t(:'F', 'vice : valide la demande de Gérald', format($q$update team_members set status = 'accepted' where team_id = %L and profile_id = %L returning status$q$, :'dolinos', :'G'));
select case when status = 'accepted' then 'PASS  ' else 'FAIL  ' end || 'Gérald accepté par le vice' from team_members where team_id = :'dolinos' and profile_id = :'G';
select _t(:'F', 'vice : ajoute un logo adverse', $q$insert into clubs_adverses (nom, alias) values ('Club Vice', '{club vice}') returning nom$q$);
select _t(:'F', 'vice : ne change pas lui-même de vice', format($q$select definir_vice_capitaine(%L, %L)::text$q$, :'dolinos', :'G'), 'Seuls un admin');
select _t(:'T', 'admin : choisit n''importe quel membre (Tony, hors équipe)', format($q$select definir_vice_capitaine(%L, %L)::text$q$, :'d1', :'T'));
select case when tm.status = 'accepted' then 'PASS  ' else 'FAIL  ' end || 'le vice désigné rejoint l''équipe' from team_members tm where tm.team_id = :'d1' and tm.profile_id = :'T';
delete from team_members where team_id = :'dolinos' and profile_id = :'F';
select case when vice_captain_id is null then 'PASS  ' else 'FAIL  ' end || 'vice retiré de l''équipe : perd son rôle' from teams where id = :'dolinos';
select _t(:'F', 'ancien vice : plus d''accès', format($q$insert into rencontres (team_id, date_match, adversaire) values (%L, '2026-12-02', 'X') returning id$q$, :'dolinos'), 'row-level security');
-- Nettoyage
delete from rencontres where adversaire = 'Test Vice'; delete from clubs_adverses where nom = 'Club Vice';
update teams set vice_captain_id = null; delete from team_members where profile_id in (:'G', :'T') and team_id in (:'dolinos', :'d1');
