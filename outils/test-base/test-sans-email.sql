-- Comptes sans email (script 035)
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set F '33333333-3333-3333-3333-333333333333'
select _t(:'F', 'simple membre : création refusée', $q$select admin_creer_membre('Jean', 'Dupont', null, 'jean.dupont', '123456')::text$q$, 'Réservé aux administrateurs');
select _t(:'T', 'admin : crée un compte identifiant + code',
  format($q$select admin_creer_membre('Jean', 'Dupont', 'Jeannot', 'Jean.Dupont', '123456', array[(select id from teams where name = 'Dolinos')])->>'identifiant'$q$));
select case when count(*) = 1 then 'PASS  ' else 'FAIL  ' end || 'auth.users : email interne, confirmé, mot de passe chiffré'
  from auth.users where email = 'jean.dupont@identifiant.dolina.invalid' and email_confirmed_at is not null and encrypted_password = extensions.crypt('123456', encrypted_password) and recovery_token = '';
select case when count(*) = 1 then 'PASS  ' else 'FAIL  ' end || 'identité email créée'
  from auth.identities i join auth.users u on u.id = i.user_id where u.email = 'jean.dupont@identifiant.dolina.invalid' and i.provider = 'email';
select case when p.status = 'active' and p.compte = 'identifiant' and p.nickname = 'Jeannot' then 'PASS  ' else 'FAIL  ' end || 'profil validé, type identifiant, surnom'
  from profiles p join auth.users u on u.id = p.id where u.email = 'jean.dupont@identifiant.dolina.invalid';
select case when tm.status = 'accepted' then 'PASS  ' else 'FAIL  ' end || 'ajouté à Dolinos'
  from team_members tm join auth.users u on u.id = tm.profile_id where u.email = 'jean.dupont@identifiant.dolina.invalid';
select _t(:'T', 'identifiant déjà pris refusé', $q$select admin_creer_membre('Jean', 'Durand', null, 'jean.dupont', '654321')::text$q$, 'déjà pris');
select _t(:'T', 'identifiant invalide refusé', $q$select admin_creer_membre('Jean', 'Durand', null, 'jean dupont!', '654321')::text$q$, 'Identifiant invalide');
select _t(:'T', 'code trop court refusé', $q$select admin_creer_membre('Jean', 'Durand', null, 'jean.durand', '123')::text$q$, 'au moins 6');
select _t(:'T', 'admin : crée un profil géré', $q$select admin_creer_membre('Marcel', 'Martin', null, 'marcel.martin', null)->>'compte'$q$);
select case when p.compte = 'gere' and u.encrypted_password <> extensions.crypt('', u.encrypted_password) then 'PASS  ' else 'FAIL  ' end || 'profil géré : code aléatoire inconnu'
  from profiles p join auth.users u on u.id = p.id where u.email = 'marcel.martin@identifiant.dolina.invalid';
select id as marcel from auth.users where email = 'marcel.martin@identifiant.dolina.invalid' \gset
select _t(:'T', 'admin : donne un code au profil géré', format($q$select admin_changer_code(%L, 'nouveau1')->>'identifiant'$q$, :'marcel'));
select case when p.compte = 'identifiant' and u.encrypted_password = extensions.crypt('nouveau1', u.encrypted_password) then 'PASS  ' else 'FAIL  ' end || 'nouveau code actif, devient identifiant'
  from profiles p join auth.users u on u.id = p.id where u.email = 'marcel.martin@identifiant.dolina.invalid';
select _t(:'T', 'compte avec vrai email : changement de code refusé', $q$select admin_changer_code('33333333-3333-3333-3333-333333333333', 'nouveau1')::text$q$, 'vrai email');
select _t(:'F', 'simple membre : changement de code refusé', format($q$select admin_changer_code(%L, 'pirate12')::text$q$, :'marcel'), 'Réservé aux administrateurs');
update auth.users set email = 'jean@exemple.fr' where email = 'jean.dupont@identifiant.dolina.invalid';
select case when p.compte = 'email' and pp.email = 'jean@exemple.fr' then 'PASS  ' else 'FAIL  ' end || 'vrai email ajouté : redevient un compte classique'
  from profiles p join profile_private pp on pp.id = p.id join auth.users u on u.id = p.id where u.email = 'jean@exemple.fr';
-- Nettoyage
delete from auth.users where email in ('jean@exemple.fr', 'marcel.martin@identifiant.dolina.invalid');
