\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set P '55555555-5555-5555-5555-555555555555'
-- Accord et chemin
select _t(:'W', 'Will : photo sans accord → effacée', $$update profiles set photo_path = '22222222-2222-2222-2222-222222222222/a.jpg' where id = auth.uid() returning coalesce(photo_path, 'null')$$, 'ok');
select (select case when photo_path is null then 'PASS  chemin effacé sans accord' else 'FAIL  chemin gardé sans accord' end from profiles where id = :'W');
select _t(:'W', 'Will : accord + photo', $$update profiles set photo_consent = true, photo_path = '22222222-2222-2222-2222-222222222222/a.jpg' where id = auth.uid() returning photo_path$$, 'ok');
select (select case when photo_path is not null then 'PASS  photo enregistrée avec accord' else 'FAIL  photo absente' end from profiles where id = :'W');
select _t(:'W', 'Will : chemin dans le dossier de Tony refusé', $$update profiles set photo_path = '11111111-1111-1111-1111-111111111111/a.jpg' where id = auth.uid()$$, 'Photo de profil invalide');
select _t(:'W', 'Will : chemin avec .. refusé', $$update profiles set photo_path = '22222222-2222-2222-2222-222222222222/../x.jpg' where id = auth.uid()$$, 'Photo de profil invalide');
select _t(:'W', 'Will : photo de Tony non modifiable', $$update profiles set photo_path = null where id = '11111111-1111-1111-1111-111111111111' returning id$$, 'ok');
-- Fichiers
select _t(:'W', 'Will envoie dans son dossier', $$insert into storage.objects (bucket_id, name) values ('photos-profil', '22222222-2222-2222-2222-222222222222/a.jpg') returning name$$, 'ok');
select _t(:'W', 'Will envoie dans le dossier de Tony → refusé', $$insert into storage.objects (bucket_id, name) values ('photos-profil', '11111111-1111-1111-1111-111111111111/b.jpg')$$, 'row-level security');
select _t(:'W', 'Will envoie à la racine → refusé', $$insert into storage.objects (bucket_id, name) values ('photos-profil', 'c.jpg')$$, 'row-level security');
select _t(:'P', 'Paul (en attente) envoie dans son dossier', $$insert into storage.objects (bucket_id, name) values ('photos-profil', '55555555-5555-5555-5555-555555555555/p.jpg') returning name$$, 'ok');
select _t(:'T', 'Tony (membre) voit la photo de Will', $$select count(*)::text from storage.objects where bucket_id = 'photos-profil' and name like '2222%'$$, 'ok');
select _t(:'P', 'Paul (en attente) voit sa photo', $$select string_agg(name, ',') from storage.objects where bucket_id = 'photos-profil'$$, 'ok');
select _t(:'W', 'Will ne supprime pas la photo de Paul', $$delete from storage.objects where name like '5555%' returning name$$, 'ok');
select (select case when count(*) = 1 then 'PASS  photo de Paul toujours là' else 'FAIL  photo de Paul supprimée' end from storage.objects where name like '5555%');
select _t(:'T', 'Tony (admin) supprime la photo de Paul', $$delete from storage.objects where name like '5555%' returning name$$, 'ok');
select (select case when count(*) = 0 then 'PASS  photo de Paul supprimée par l''admin' else 'FAIL  photo de Paul encore là' end from storage.objects where name like '5555%');
begin; set local role anon; select 'visiteur voit ' || count(*) || ' photo(s) (attendu 0)' from storage.objects where bucket_id = 'photos-profil'; commit;
-- Retrait de l'accord
select _t(:'W', 'Will retire son accord', $$update profiles set photo_consent = false where id = auth.uid() returning id$$, 'ok');
select (select case when photo_path is null then 'PASS  accord retiré → photo retirée du profil' else 'FAIL  photo gardée' end from profiles where id = :'W');
