-- Calendrier des équipes (script 030) : lecture publique, saisie capitaine / admin
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set P '55555555-5555-5555-5555-555555555555'
-- Will capitaine de Dolina 1
update teams set captain_id = :'W' where name = 'Dolina 1';
select set_config('t.d1', (select id::text from teams where name = 'Dolina 1'), false);
select set_config('t.d2', (select id::text from teams where name = 'Dolina 2'), false);

-- Visiteur anonyme : lecture du calendrier et des salles
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;
select case when _anon('select count(*)::text from salles') = (select count(*)::text from salles) then 'PASS  visiteur : salles visibles' else 'FAIL  visiteur salles : ' || _anon('select count(*)::text from salles') end;

select _t(:'W', 'capitaine : ajoute une rencontre à son équipe',
  format($q$insert into rencontres (team_id, date_match, heure_match, adversaire, domicile) values (%L, '2026-11-05', '20:30', 'Les Archers', false) returning adversaire$q$, current_setting('t.d1')));
select _t(:'W', 'capitaine : refusé pour une autre équipe',
  format($q$insert into rencontres (team_id, date_match, adversaire) values (%L, '2026-11-05', 'X') returning id$q$, current_setting('t.d2')), 'row-level security');
select _t(:'F', 'simple membre : refusé',
  format($q$insert into rencontres (team_id, date_match, adversaire) values (%L, '2026-11-05', 'X') returning id$q$, current_setting('t.d1')), 'row-level security');
select _t(:'T', 'admin : ajoute pour Dolina 2',
  format($q$insert into rencontres (team_id, date_match, adversaire, score_nous, score_eux) values (%L, '2026-10-01', 'Les Flèches', 12, 8) returning score_nous || '-' || score_eux$q$, current_setting('t.d2')));
select _t(:'W', 'capitaine : saisit le score',
  $q$update rencontres set score_nous = 10, score_eux = 10 where adversaire = 'Les Archers' returning score_nous || '-' || score_eux$q$);
select _t(:'W', 'score incomplet refusé',
  $q$update rencontres set score_eux = null where adversaire = 'Les Archers' returning id$q$, 'rencontres_score_complet');
select _t(:'W', 'capitaine : ne modifie pas Dolina 2 (0 ligne)',
  $q$with u as (update rencontres set adversaire = 'Piraté' where adversaire = 'Les Flèches' returning 1) select count(*)::text from u$q$);
select case when _anon('select count(*)::text from rencontres') = (select count(*)::text from rencontres) then 'PASS  visiteur : rencontres visibles' else 'FAIL  visiteur rencontres' end;
select _t(:'W', 'capitaine : ajoute une salle', $q$insert into salles (nom, adresse) values ('Bar Le Bullseye', '1 rue X, Paris') returning nom$q$);
select _t(:'F', 'simple membre : pas de salle', $q$insert into salles (nom, adresse) values ('Y', 'Z') returning nom$q$, 'row-level security');
select _t(:'W', 'capitaine : ne supprime pas une salle (0 ligne)', $q$with d as (delete from salles where nom = 'Bar Le Bullseye' returning 1) select count(*)::text from d$q$);
select _t(:'T', 'admin : supprime une salle', $q$with d as (delete from salles where nom = 'Bar Le Bullseye' returning 1) select count(*)::text from d$q$);
select _t(:'W', 'lien de carte non https refusé', $q$insert into salles (nom, adresse, lien_carte) values ('Q', 'R', 'javascript:alert(1)') returning nom$q$, 'salles_lien_carte_check');
select _t(:'W', 'capitaine : supprime sa rencontre', $q$with d as (delete from rencontres where adversaire = 'Les Archers' returning 1) select count(*)::text from d$q$);
-- Capitaine plus capitaine : plus de droits
update teams set captain_id = null where name = 'Dolina 1';
select _t(:'W', 'ancien capitaine : refusé',
  format($q$insert into rencontres (team_id, date_match, adversaire) values (%L, '2026-11-05', 'X') returning id$q$, current_setting('t.d1')), 'row-level security');
