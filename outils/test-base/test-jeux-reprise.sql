-- Jeux du club : reprise sur un autre appareil (script 040)
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
insert into jeux_parties (jeu, joueurs, statut, actions, created_by) values
  ('pentadarts', '[{"nom":"Tony","profile_id":"11111111-1111-1111-1111-111111111111"},{"nom":"Will","profile_id":"22222222-2222-2222-2222-222222222222"},{"nom":"Invité"}]', 'live', '[]', :'T')
returning id as partie \gset
select _t(:'T', 'créateur : enregistre une volée', format($q$update jeux_parties set actions = '[{"fleches":[50,0,0]}]' where id = %L returning jsonb_array_length(actions)::text$q$, :'partie'));
select _t(:'W', 'joueur (autre appareil) : continue la partie', format($q$update jeux_parties set actions = actions || '[{"fleches":[25,0,0]}]' where id = %L returning jsonb_array_length(actions)::text$q$, :'partie'));
select _t(:'F', 'membre hors partie : ne modifie rien (0 ligne)', format($q$update jeux_parties set actions = '[]' where id = %L returning 'modifié'$q$, :'partie'));
select case when jsonb_array_length(actions) = 2 then 'PASS  ' else 'FAIL  ' end || 'partie intacte' from jeux_parties where id = :'partie';
select _t(:'W', 'joueur : ne vole pas la partie (créateur inchangé)', format($q$update jeux_parties set created_by = %L where id = %L returning created_by::text$q$, :'W', :'partie'));
select case when created_by = :'T' then 'PASS  ' else 'FAIL  ' end || 'créateur toujours Tony' from jeux_parties where id = :'partie';
select _t(:'W', 'joueur : termine la partie', format($q$update jeux_parties set statut = 'finished', resultat = '{"totaux":{}}' where id = %L returning statut$q$, :'partie'));
select _t(:'W', 'partie terminée : plus modifiable (0 ligne)', format($q$update jeux_parties set actions = '[]' where id = %L returning 'modifié'$q$, :'partie'));
select _t(:'T', 'créateur : supprime', format($q$delete from jeux_parties where id = %L returning 'supprimé'$q$, :'partie'));
