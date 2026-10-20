-- Jeux du club (script 039)
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set P '55555555-5555-5555-5555-555555555555'
select _t(:'W', 'membre : enregistre une partie de Pentadarts', $q$insert into jeux_parties (jeu, joueurs, resultat) values ('pentadarts', '[{"nom":"Will"},{"nom":"Tony"},{"nom":"Invité"}]', '{"totaux":{}}') returning jeu$q$);
select _t(:'W', 'membre : ne peut pas se faire passer pour un autre', format($q$insert into jeux_parties (jeu, joueurs, resultat, created_by) values ('capital', '[{"nom":"X"}]', '{}', %L) returning id$q$, :'T'), 'row-level security');
select _t(:'P', 'compte en attente : refusé', $q$insert into jeux_parties (jeu, joueurs, resultat) values ('capital', '[{"nom":"X"}]', '{}') returning id$q$, 'row-level security');
select _t(:'W', 'jeu inconnu refusé', $q$insert into jeux_parties (jeu, joueurs, resultat) values ('cricket', '[{"nom":"X"}]', '{}') returning id$q$, 'jeux_parties_jeu_check');
select _t(:'T', 'membre : lit l''historique', $q$select count(*)::text from jeux_parties$q$);
select _t(:'P', 'compte en attente : ne lit rien', $q$select count(*)::text from jeux_parties$q$);
select _t(:'T', 'admin : supprime', $q$delete from jeux_parties where jeu = 'pentadarts' returning 'supprimé'$q$);
