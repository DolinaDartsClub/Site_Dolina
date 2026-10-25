-- Script 061 : donner un email à un membre créé sans email
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\pset tuples_only on
\pset format unaligned
select _t(:'T', 'créer un membre sans email', $$select admin_creer_membre('Jean', 'Dupont', null, 'jean.dupont', 'code123')::text$$);
select set_config('t.j', (select id::text from auth.users where email = 'jean.dupont@identifiant.dolina.invalid'), false);
select _t(:'W', 'membre : refusé', $$select admin_ajouter_email(current_setting('t.j')::uuid, 'jean@exemple.fr')::text$$, 'Réservé');
select _t(:'T', 'email invalide', $$select admin_ajouter_email(current_setting('t.j')::uuid, 'pas-un-email')::text$$, 'invalide');
select _t(:'T', 'email déjà pris', $$select admin_ajouter_email(current_setting('t.j')::uuid, 'will@test.fr')::text$$, 'déjà utilisé');
select _t(:'T', 'téléphone invalide', $$select admin_ajouter_email(current_setting('t.j')::uuid, 'jean@exemple.fr', '12')::text$$, 'téléphone');
select _t(:'T', 'ajout email + téléphone', $$select admin_ajouter_email(current_setting('t.j')::uuid, ' Jean@Exemple.fr ', '06 12 34 56 78') ->> 'email'$$);
select 'compte / privé (attendu email | jean@exemple.fr | 06 12 34 56 78) → ' || (select compte from profiles where id = current_setting('t.j')::uuid) || ' | ' || email || ' | ' || phone from profile_private where id = current_setting('t.j')::uuid;
select 'auth (attendu jean@exemple.fr / jean@exemple.fr) → ' || u.email || ' / ' || (select identity_data ->> 'email' from auth.identities i where i.user_id = u.id) from auth.users u where id = current_setting('t.j')::uuid;
select _t(:'T', 'deuxième fois : refusé (a déjà un email)', $$select admin_ajouter_email(current_setting('t.j')::uuid, 'autre@exemple.fr')::text$$, 'déjà un email');
