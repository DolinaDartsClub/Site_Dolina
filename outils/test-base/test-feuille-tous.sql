-- Script 078 : feuille CPARD, tout le monde peut scorer
\pset tuples_only on
\pset format unaligned
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;
update teams set captain_id = :'W' where name = 'Dolina 2';
delete from team_members where team_id = (select id from teams where name = 'Dolina 2') and profile_id = :'F';
insert into rencontres (team_id, date_match, adversaire, domicile) select id, current_date, 'Adversaire T', true from teams where name = 'Dolina 2';
select _t(:'W', 'feuille', $$select creer_feuille((select id from rencontres where adversaire = 'Adversaire T'), 'A', 4)::text$$);
select null from set_config('t.f', (select id::text from feuilles_match order by created_at desc limit 1), false);
select null from set_config('t.c', (select code from feuilles_match where id = current_setting('t.f')::uuid), false);
select _t(:'W', 'compo A', $$select enregistrer_compo(current_setting('t.f')::uuid, 'A', '{"A":{"n":"A1"},"B":{"n":"B1"},"C":{"n":"C1"},"D":{"n":"D1"},"A1":["A","B"],"A2":["C","D"]}')::text$$);
select _anon(format($q$select enregistrer_compo(null, 'E', '{"E":{"n":"E1"},"F":{"n":"F1"},"G":{"n":"G1"},"H":{"n":"H1"},"E1":["E","F"],"E2":["G","H"]}', %L)::text$q$, current_setting('t.c'))) is not null as compo_e;
select case when _anon(format('select saisir_resultat_feuille_code(%L, 1, 2, 0)::text', current_setting('t.c'))) like 'ERREUR%pas encore lancée%' then 'PASS  avant lancement : refusé' else 'FAIL  avant lancement' end;
select _t(:'W', 'lancement', $$select lancer_rencontre(current_setting('t.f')::uuid)::text$$);
select case when _anon(format('select saisir_resultat_feuille_code(%L, 1, 2, 1)::text', current_setting('t.c'))) not like 'ERREUR%' then 'PASS  lien adverse sans compte : saisit le score' else 'FAIL  lien adverse saisie' end;
select case when _anon('select saisir_resultat_feuille_code(''ZZZZZZ'', 2, 2, 0)::text') like 'ERREUR%pas valide%' then 'PASS  mauvais lien : refusé' else 'FAIL  mauvais lien' end;
select case when _anon(format('select saisir_resultat_feuille(%L, 2, 2, 0)::text', current_setting('t.f'))) like 'ERREUR%' then 'PASS  visiteur sans le lien : refusé' else 'FAIL  visiteur sans lien' end;
select _t(:'F', 'membre du club hors équipe : saisit le score', $$select coalesce(saisir_resultat_feuille(current_setting('t.f')::uuid, 2, 0, 2)::text, 'ok')$$);
select _t(:'F', 'membre du club hors équipe : lance le scorer', $$select lancer_match_feuille(current_setting('t.f')::uuid, 3)::text$$);
select _t(:'F', 'membre hors équipe : ne corrige pas', $$select remettre_match_feuille(current_setting('t.f')::uuid, 1)::text$$, 'capitaine');
select case when (select string_agg(numero || ':' || manches_a || '-' || manches_e, ' ' order by numero) from feuille_matchs where feuille_id = current_setting('t.f')::uuid and statut = 'termine') = '1:2-1 2:0-2'
  then 'PASS  scores enregistrés (match 1 par le lien, match 2 par un membre)' else 'FAIL  scores enregistrés' end;
-- Scorer complet par le lien (sans compte)
select null from set_config('t.g', _anon(format('select lancer_match_feuille_code(%L, 5)::text', current_setting('t.c'))), false);
select case when current_setting('t.g') ~ '^[0-9a-f-]{36}$' then 'PASS  lien sans compte : lance le scorer' else 'FAIL  lancer par lien : ' || current_setting('t.g') end;
select case when (select created_by from games where id = current_setting('t.g')::uuid) = :'W' then 'PASS  partie au nom du capitaine de la feuille' else 'FAIL  créateur de la partie' end;
select case when _anon(format($q$select volee_feuille_code(%L, %L, '{"leg_no":1,"visit_no":1,"side":1,"score":100,"remaining_before":501}')::text$q$, current_setting('t.c'), current_setting('t.g'))) ~ '^\d+$' then 'PASS  volée saisie par le lien' else 'FAIL  volée par le lien' end;
select case when _anon(format($q$select volee_feuille_code('ZZZZZZ', %L, '{"leg_no":1,"visit_no":1,"side":2,"score":60,"remaining_before":501}')::text$q$, current_setting('t.g'))) like 'ERREUR%' then 'PASS  mauvais lien : volée refusée' else 'FAIL  mauvais lien volée' end;
select case when _anon(format($q$insert into visits (game_id, leg_no, visit_no, side, score, remaining_before) values (%L, 1, 2, 2, 60, 501) returning 'ok'$q$, current_setting('t.g'))) like 'ERREUR%' then 'PASS  écriture directe impossible sans compte' else 'FAIL  écriture directe' end;
select null from set_config('t.r', coalesce(_anon(format('select annuler_volees_feuille_code(%L, %L, %L::bigint[])::text', current_setting('t.c'), current_setting('t.g'), (select array_agg(id) from visits where game_id = current_setting('t.g')::uuid))), ''), false);
select case when current_setting('t.r') not like 'ERREUR%' and (select count(*) from visits where game_id = current_setting('t.g')::uuid) = 0 then 'PASS  annulation par le lien' else 'FAIL  annulation par le lien ' || current_setting('t.r') end;
-- deux manches gagnées par A, fin, report sur la feuille
select _anon(format($q$select volee_feuille_code(%L, %L, '{"leg_no":%s,"visit_no":1,"side":1,"score":100,"remaining_before":100,"is_checkout":true,"darts_used":3,"darts_at_double":1}')::text$q$, current_setting('t.c'), current_setting('t.g'), l)) is not null from generate_series(1, 2) l;
select case when coalesce(_anon(format('select statut_partie_feuille_code(%L, %L, true, 1)::text', current_setting('t.c'), current_setting('t.g'))), '') not like 'ERREUR%' then 'PASS  fin de partie par le lien' else 'FAIL  fin de partie' end;
select null from set_config('t.r', coalesce(_anon(format('select valider_match_feuille_code(%L, %L)::text', current_setting('t.c'), current_setting('t.g'))), ''), false);
select case when current_setting('t.r') not like 'ERREUR%' and (select statut || ' ' || manches_a || '-' || manches_e from feuille_matchs where feuille_id = current_setting('t.f')::uuid and numero = 5) = 'termine 2-0' then 'PASS  résultat reporté sur la feuille (2-0)' else 'FAIL  report ' || current_setting('t.r') end;
select case when _anon(format($q$select volee_feuille_code(%L, %L, '{"leg_no":3,"visit_no":1,"side":1,"score":60,"remaining_before":501}')::text$q$, current_setting('t.c'), current_setting('t.g'))) like 'ERREUR%plus modifiable%' then 'PASS  après report : partie figée pour le lien' else 'FAIL  partie figée' end;
-- Abandon par le lien (d'abord libérer les joueurs du match 3, lancé plus haut)
delete from games where id = (select game_id from feuille_matchs where feuille_id = current_setting('t.f')::uuid and numero = 3);
select null from set_config('t.g2', _anon(format('select lancer_match_feuille_code(%L, 6)::text', current_setting('t.c'))), false);
select null from set_config('t.r', coalesce(_anon(format('select abandonner_partie_feuille_code(%L, %L)::text', current_setting('t.c'), current_setting('t.g2'))), ''), false);
select case when current_setting('t.r') not like 'ERREUR%' and (select statut from feuille_matchs where feuille_id = current_setting('t.f')::uuid and numero = 6) = 'a_jouer' then 'PASS  abandon par le lien : match à rejouer' else 'FAIL  abandon ' || current_setting('t.r') end;
