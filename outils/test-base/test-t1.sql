\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
\set P '55555555-5555-5555-5555-555555555555'
\pset tuples_only on
\pset format unaligned
-- Création
select _t(:'P', 'membre en attente ne peut pas créer', $$insert into tournaments(name, format, max_participants) values ('X','knockout',8) returning id$$, 'row-level security');
select _t(:'W', 'Will crée un tournoi KO (4 places)', $$insert into tournaments(name, format, max_participants, status) values ('Coupe Will','knockout',4,'open') returning code$$);
select _t(:'W', 'statut running refusé à la création → draft', $$insert into tournaments(name, format, status) values ('Test statut','knockout','running') returning status$$);
select _t(:'W', 'tournoi poules sans qualifiés refusé', $$insert into tournaments(name, format) values ('Poules','pools') returning id$$, 'check constraint');
select _t(:'W', 'nom trop court refusé', $$insert into tournaments(name, format) values ('A','knockout') returning id$$, 'check constraint');
select _t(:'W', 'code imposé ignoré', $$insert into tournaments(name, format, code) values ('Code imposé','knockout','AAAAAA') returning (code <> 'AAAAAA')::text$$);
-- Lecture
select _t(:'F', 'Franck (non inscrit) ne voit pas le tournoi', $$select count(*)::text from tournaments where name='Coupe Will'$$) ;
select _t(:'T', 'admin voit le tournoi', $$select count(*)::text from tournaments where name='Coupe Will'$$);
-- Rejoindre
select set_config('test.code', (select code from tournaments where name='Coupe Will'), false);
select set_config('test.draft', (select code from tournaments where name='Test statut'), false);
select _t(:'F', 'code invalide (format)', $$select apercu_tournoi('AB12')::text$$, '6 caractères');
select _t(:'F', 'code inconnu', $$select apercu_tournoi('ZZZZZZ')::text$$, 'Aucun tournoi');
select _t(:'F', 'aperçu avec code en minuscules et tiret', $$select apercu_tournoi(lower(substr(current_setting('test.code'),1,3)) || '-' || substr(current_setting('test.code'),4))->>'name'$$);
select _t(:'P', 'compte en attente refusé', $$select rejoindre_tournoi(current_setting('test.code'))::text$$, 'validé');
select _t(:'F', 'Franck rejoint', $$select rejoindre_tournoi(current_setting('test.code'))::text$$);
select _t(:'F', 'Franck rejoint deux fois → refus', $$select rejoindre_tournoi(current_setting('test.code'))::text$$, 'déjà inscrit');
select _t(:'F', 'Franck voit maintenant le tournoi et le code', $$select code from tournaments where name='Coupe Will'$$);
select _t(:'F', 'tournoi en préparation : inscription refusée', $$select rejoindre_tournoi(current_setting('test.draft'))::text$$, 'pas encore ouvertes');
-- Ajouts manuels
select _t(:'F', 'participant ne peut pas ajouter un invité', $$insert into tournament_entries(tournament_id, guest_name) select id, 'Invité' from tournaments where name='Coupe Will' returning id$$, 'row-level security');
select _t(:'W', 'organisateur ajoute un invité', $$insert into tournament_entries(tournament_id, guest_name) select id, ' Jean ' from tournaments where name='Coupe Will' returning guest_name$$);
select _t(:'W', 'invité en double refusé', $$insert into tournament_entries(tournament_id, guest_name) select id, 'jean' from tournaments where name='Coupe Will' returning id$$, 'déjà inscrit');
select _t(:'W', 'organisateur ajoute Gérald (membre)', $$insert into tournament_entries(tournament_id, profile_id) select id, '44444444-4444-4444-4444-444444444444' from tournaments where name='Coupe Will' returning id$$);
select _t(:'W', 'Gérald en double refusé', $$insert into tournament_entries(tournament_id, profile_id) select id, '44444444-4444-4444-4444-444444444444' from tournaments where name='Coupe Will' returning id$$, 'déjà inscrit');
select _t(:'W', 'Will s''inscrit lui-même (4e place)', $$select rejoindre_tournoi(current_setting('test.code'))::text$$);
select _t(:'T', 'tournoi complet : Tony refusé', $$select rejoindre_tournoi(current_setting('test.code'))::text$$, 'complet');
select _t(:'W', 'réduire les places sous le nombre d''inscrits refusé', $$update tournaments set max_participants=3 where name='Coupe Will' returning id$$, 'déjà 4 inscrits');
select _t(:'F', 'participant ne peut pas modifier le tournoi', $$update tournaments set name='Piraté' where name='Coupe Will' returning id::text$$);
select _t(:'W', 'vérif : nom inchangé', $$select name from tournaments where code=current_setting('test.code')$$);
select _t(:'W', 'organisateur ne peut pas passer « en cours » à la main', $$update tournaments set status='running' where name='Coupe Will' returning id$$, 'au lancement');
select _t(:'W', 'organisateur ne peut pas changer le code', $$update tournaments set code='BBBBBB' where name='Coupe Will' returning (code = current_setting('test.code'))::text$$);
select _t(:'F', 'Franck se désinscrit', $$delete from tournament_entries where profile_id='33333333-3333-3333-3333-333333333333' and tournament_id = (select id from tournaments where name='Coupe Will') returning id::text$$);
select _t(:'F', 'Franck ne voit plus le tournoi', $$select count(*)::text from tournaments where name='Coupe Will'$$);
select _t(:'G', 'Gérald ne peut pas retirer l''invité', $$delete from tournament_entries where guest_name='Jean' returning id::text$$);
select _t(:'W', 'vérif : 3 inscrits', $$select count(*)::text from tournament_entries e join tournaments t on t.id=e.tournament_id where t.name='Coupe Will'$$);
-- Fermeture des inscriptions
select _t(:'W', 'organisateur ferme les inscriptions', $$update tournaments set status='draft' where name='Coupe Will' returning status$$);
select _t(:'T', 'inscriptions fermées : refus', $$select rejoindre_tournoi(current_setting('test.code'))::text$$, 'pas encore ouvertes');
-- Tournoi lancé (simulé) : inscriptions et retraits bloqués
select set_config('dolina.interne','oui',false); update tournaments set status='running' where name='Coupe Will'; select set_config('dolina.interne','',false);
select _t(:'W', 'tournoi commencé : ajout refusé', $$insert into tournament_entries(tournament_id, guest_name) select id, 'Tard' from tournaments where name='Coupe Will' returning id$$, 'a déjà commencé');
select _t(:'G', 'tournoi commencé : désinscription refusée', $$delete from tournament_entries where profile_id='44444444-4444-4444-4444-444444444444' returning id$$, 'a commencé');
select _t(:'W', 'tournoi commencé : paramètres figés', $$update tournaments set max_participants=8 where name='Coupe Will' returning id$$, 'ne peuvent plus');
-- Double
select _t(:'G', 'Gérald crée un tournoi en double', $$insert into tournaments(name, format, team_mode, max_participants, status, pool_qualifiers, pools_count) values ('Doubles du jeudi','pools','double',8,'open',2,2) returning code$$);
select set_config('test.dbl', (select code from tournaments where name='Doubles du jeudi'), false);
select _t(:'F', 'double sans nom d''équipe refusé', $$select rejoindre_tournoi(current_setting('test.dbl'), null, '22222222-2222-2222-2222-222222222222')::text$$, 'nom à la doublette');
select _t(:'F', 'double sans partenaire refusé', $$select rejoindre_tournoi(current_setting('test.dbl'), 'Les Flèches')::text$$, 'partenaire');
select _t(:'F', 'Franck + Will (membre) rejoignent', $$select rejoindre_tournoi(current_setting('test.dbl'), 'Les Flèches', '22222222-2222-2222-2222-222222222222')::text$$);
select _t(:'W', 'Will (déjà partenaire) ne peut pas s''inscrire à nouveau', $$select rejoindre_tournoi(current_setting('test.dbl'), 'Solo Will', null, 'Bob')::text$$, 'déjà inscrit');
select _t(:'W', 'Will voit le tournoi en tant que partenaire', $$select name from tournaments where code=current_setting('test.dbl')$$);
select _t(:'T', 'Tony + invité, nom d''équipe déjà pris refusé', $$select rejoindre_tournoi(current_setting('test.dbl'), 'les flèches', null, 'Marco')::text$$, 'déjà');
select _t(:'T', 'Tony + invité Marco', $$select rejoindre_tournoi(current_setting('test.dbl'), 'Big Team', null, 'Marco')::text$$);
select _t(:'G', 'nom des inscrits', $$select string_agg(nom_inscrit(e), ', ' order by e.created_at) from tournament_entries e join tournaments t on t.id=e.tournament_id where t.name='Doubles du jeudi'$$);
select _t(:'G', 'passer en individuel avec inscrits refusé', $$update tournaments set team_mode='single' where name='Doubles du jeudi' returning id$$, 'ne peut plus changer');
select _t(:'G', 'passer en KO efface les réglages de poules', $$update tournaments set format='knockout' where name='Doubles du jeudi' returning coalesce(pools_count::text,'null')$$);
-- Suppression
select _t(:'F', 'participant ne peut pas supprimer', $$delete from tournaments where name='Doubles du jeudi' returning id::text$$);
select _t(:'G', 'organisateur supprime (inscrits supprimés avec)', $$with d as (delete from tournaments where name='Doubles du jeudi' returning id) select count(*)::text from d$$);
select 'reste inscrits orphelins : ' || count(*) from tournament_entries e where not exists (select 1 from tournaments t where t.id=e.tournament_id);
-- Anonymisation d'un compte supprimé alors que le tournoi est en cours
delete from auth.users where id='44444444-4444-4444-4444-444444444444';
select _t(:'W', 'compte supprimé : « Ancien joueur »', $$select string_agg(nom_inscrit(e), ', ' order by e.created_at) from tournament_entries e join tournaments t on t.id=e.tournament_id where t.name='Coupe Will'$$);
-- Visiteur
select _t(null, 'visiteur : aucun tournoi visible', $$select count(*)::text from tournaments$$);
