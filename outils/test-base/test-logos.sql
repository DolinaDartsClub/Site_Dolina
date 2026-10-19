-- Logos des adversaires (script 034) : lecture publique, ajout capitaine / admin
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
-- Will capitaine des Dolinos, pas de vice (le test se suffit à lui-même)
update teams set captain_id = null, vice_captain_id = null;
update teams set captain_id = :'W' where name = 'Dolinos';
\set F '33333333-3333-3333-3333-333333333333'
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;
select case when _anon('select count(*)::text from clubs_adverses') = '12' then 'PASS  visiteur : 12 clubs visibles' else 'FAIL  visiteur : ' || _anon('select count(*)::text from clubs_adverses') end;
select _t(:'W', 'capitaine : change le logo d''un club', $q$update clubs_adverses set logo = 'logos/abc.webp' where nom = 'Sputnik' returning logo$q$);
select _t(:'W', 'capitaine : crée un club', $q$insert into clubs_adverses (nom, alias, logo) values ('Les Archers', '{les archers}', 'logos/x.png') returning nom$q$);
select _t(:'F', 'simple membre : création refusée', $q$insert into clubs_adverses (nom) values ('Pirates') returning id$q$, 'row-level security');
select case when (select logo from clubs_adverses where nom = 'Sputnik') = 'logos/abc.webp' then 'PASS  ' else 'FAIL  ' end || 'logo enregistré';
select _t(:'F', 'simple membre : modification sans effet', $q$update clubs_adverses set logo = null where nom = 'Sputnik' returning 'modifié'$q$);
select case when (select logo from clubs_adverses where nom = 'Sputnik') = 'logos/abc.webp' then 'PASS  ' else 'FAIL  ' end || 'logo inchangé par un simple membre';
select _t(:'T', 'lien externe refusé', $q$update clubs_adverses set logo = 'https://exemple.com/x.png' where nom = 'Sputnik' returning id$q$, 'clubs_adverses_logo_check');
select _t(:'W', 'capitaine : suppression sans effet', $q$delete from clubs_adverses where nom = 'Sputnik' returning 'supprimé'$q$);
select _t(:'T', 'admin : supprime un club', $q$delete from clubs_adverses where nom = 'Les Archers' returning 'supprimé'$q$);
select _t(:'W', 'stockage : capitaine envoie dans logos/', $q$with i as (insert into storage.objects (bucket_id, name) values ('public-images', 'logos/t.webp')) select 'envoyé'$q$);
select _t(:'W', 'stockage : capitaine refusé hors logos/', $q$with i as (insert into storage.objects (bucket_id, name) values ('public-images', 'actus/t.webp')) select 'envoyé'$q$, 'row-level security');
select _t(:'F', 'stockage : simple membre refusé', $q$with i as (insert into storage.objects (bucket_id, name) values ('public-images', 'logos/u.webp')) select 'envoyé'$q$, 'row-level security');
update teams set captain_id = null, vice_captain_id = null;
