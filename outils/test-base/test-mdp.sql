-- Mot de passe provisoire (script 038)
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; r := coalesce(r, 'ok'); exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;
select case when _anon($q$select envoyer_demande_contact_v2('mot_de_passe', 'Franck', 'Petit', '0612345678', 'franck@test.fr', 'Compte : franck@test.fr', 'whatsapp', '')::text$q$) not like 'ERREUR%' then 'PASS  ' else 'FAIL  ' end || 'visiteur : demande « mot de passe oublié » envoyée';
select case when count(*) = 1 then 'PASS  ' else 'FAIL  ' end || 'demande visible avec le motif mot_de_passe' from contact_requests where motif = 'mot_de_passe' and first_name = 'Franck';
insert into auth.users (id, email, encrypted_password) values (:'F', 'franck@test.fr', 'x') on conflict (id) do update set email = excluded.email;
select _t(:'W', 'simple membre : refusé', format($q$select admin_mot_de_passe_provisoire(%L, 'provis1')::text$q$, :'F'), 'Réservé aux administrateurs');
select _t(:'T', 'admin : code trop court refusé', format($q$select admin_mot_de_passe_provisoire(%L, '123')::text$q$, :'F'), 'au moins 6');
select _t(:'T', 'admin : mot de passe provisoire pour Franck', format($q$select admin_mot_de_passe_provisoire(%L, 'provis1')->>'connexion'$q$, :'F'));
select case when u.encrypted_password = extensions.crypt('provis1', u.encrypted_password) and p.mdp_provisoire then 'PASS  ' else 'FAIL  ' end || 'nouveau mot de passe actif, marqué provisoire'
  from auth.users u join profiles p on p.id = u.id where u.id = :'F';
update profiles set role = 'admin' where id = :'W';
select _t(:'T', 'admin : refusé pour un autre admin', format($q$select admin_mot_de_passe_provisoire(%L, 'provis1')::text$q$, :'W'), 'autre admin');
update profiles set role = 'member' where id = :'W';
select _t(:'F', 'membre : signale qu''il a changé son mot de passe', $q$select mot_de_passe_change()::text$q$);
select case when not mdp_provisoire then 'PASS  ' else 'FAIL  ' end || 'bandeau provisoire retiré' from profiles where id = :'F';
-- Nettoyage
delete from contact_requests where motif = 'mot_de_passe'; update auth.users set encrypted_password = null where id = :'F';
