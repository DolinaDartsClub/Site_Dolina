-- Script 056 : feuille de match CPARD
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
-- Will capitaine de Dolina 2, Franck joueur de Dolina 2, Gérald hors équipe
update teams set captain_id = :'W' where name = 'Dolina 2';
insert into team_members (team_id, profile_id, status) select id, :'F', 'accepted' from teams where name = 'Dolina 2';
insert into rencontres (team_id, date_match, adversaire, domicile, division, poule, journee)
select id, '2026-10-13', 'Darting Test', false, '1', 'B', 'J2' from teams where name = 'Dolina 2';
select set_config('t.r', (select id::text from rencontres where adversaire = 'Darting Test'), false);
-- Vérification d'une valeur (hors droits)
create or replace function _v(label text, q text, attendu text) returns text language plpgsql as $f$
declare r text; begin execute q into r;
  return case when r is not distinct from attendu then 'PASS  ' || label || '  → ' || coalesce(r, 'null') else 'FAIL  ' || label || '  attendu: ' || attendu || '  obtenu: ' || coalesce(r, 'null') end; end $f$;
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;

select _t(:'F', 'simple joueur : ne crée pas la feuille', $$select creer_feuille(current_setting('t.r')::uuid)::text$$, 'Seuls le capitaine');
select _t(:'W', 'capitaine : crée la feuille (camp E, 2 cibles)', $$select creer_feuille(current_setting('t.r')::uuid, 'E', 2)::text$$);
select set_config('t.f', (select id::text from feuilles_match), false);
select set_config('t.c', (select code from feuilles_match), false);
select _t(:'W', 'recréer = même feuille', $$select (1 / (creer_feuille(current_setting('t.r')::uuid) = current_setting('t.f')::uuid)::int)::text$$);
select _v('20 matchs créés', $$select count(*)::text from feuille_matchs where feuille_id = current_setting('t.f')::uuid$$, '20');
select _t(:'G', 'membre hors équipe : lecture seule', $$select feuille_detail(current_setting('t.f')::uuid) ->> 'role'$$);
select _t(:'G', 'membre hors équipe : pas le code', $$select (1 / ((feuille_detail(current_setting('t.f')::uuid) -> 'feuille' ->> 'code') is null)::int)::text$$);
select case when _anon(format('select feuille_detail(null, %L) ->> ''role''', lower(current_setting('t.c')))) = 'adverse' then 'PASS  adverse : ouvre par le lien' else 'FAIL  adverse lien' end;
select case when _anon(format('select feuille_detail(%L)', current_setting('t.f'))) like 'ERREUR%réservée%' then 'PASS  visiteur sans lien : refusé' else 'FAIL  visiteur sans lien' end;

-- Compositions
select _t(:'W', 'compo E (membres + invités)', format($$select enregistrer_compo(%L, 'E', '{"E":{"p":"%s"},"F":{"p":"%s"},"G":{"n":"  Invité   G "},"H":{"n":"Invité H"},"Z":{"n":"Rempl Z"},"E1":["F","H"],"E2":["E","G"]}')::text$$, current_setting('t.f'), :'W', :'F'));
select _v('nom figé : prénom nom, espaces nettoyés', $$select compo_e -> 'E' ->> 'n' || ' / ' || (compo_e -> 'G' ->> 'n') from feuilles_match$$, 'Will Martin / Invité G');
select _t(:'W', 'même joueur deux fois refusé', format($$select enregistrer_compo(%L, 'E', '{"E":{"p":"%s"},"F":{"p":"%s"}}')::text$$, current_setting('t.f'), :'W', :'W'), 'deux fois');
select case when _anon(format($q$select enregistrer_compo(null, 'E', '{"E":{"n":"Pirate"}}', %L)$q$, current_setting('t.c'))) like 'ERREUR%votre équipe%' then 'PASS  adverse : ne touche pas notre compo' else 'FAIL  adverse compo E' end;
select _t(:'W', 'lancement avant compo adverse : refusé', $$select lancer_rencontre(current_setting('t.f')::uuid)::text$$, 'complètes avant le lancement (équipe A');
select _t(:'W', 'capitaine : ne saisit pas la compo adverse avant le lancement', $$select enregistrer_compo(current_setting('t.f')::uuid, 'A', '{"A":{"n":"X"}}')::text$$, 'saisie par son capitaine');
select case when _anon(format($q$select enregistrer_compo(null, 'A', '{"A":{"n":"Adrien"},"B":{"n":"Alexandre"},"C":{"n":"Romain"},"D":{"n":"Alan"},"Y":{"n":"Loïc"},"A1":["A","B"],"A2":["D","C"]}', %L)::text$q$, current_setting('t.c'))) is not distinct from '' then 'PASS  adverse : saisit sa compo' else 'FAIL  adverse compo A : ' || _anon(format($q$select enregistrer_compo(null, 'A', '{}', %L)::text$q$, current_setting('t.c'))) end;
select _t(:'W', 'avant lancement : compo adverse masquée, prête', $$select (feuille_detail(current_setting('t.f')::uuid) -> 'feuille' ->> 'compo_a') || ' ' || (feuille_detail(current_setting('t.f')::uuid) -> 'feuille' ->> 'pret_a')$$);
select _t(:'W', 'avant lancement : noms adverses masqués dans les matchs', $$select coalesce(feuille_detail(current_setting('t.f')::uuid) -> 'matchs' -> 0 -> 'joueurs' ->> 'a', 'masqué') || ' / ' || (feuille_detail(current_setting('t.f')::uuid) -> 'matchs' -> 0 -> 'joueurs' -> 'e' -> 0 ->> 'n')$$);
select case when _anon(format('select feuille_detail(null, %L) -> ''feuille'' ->> ''compo_e''', current_setting('t.c'))) = '{}' then 'PASS  adverse : notre compo masquée' else 'FAIL  adverse voit notre compo' end;
select case when _anon(format('select feuille_detail(null, %L) -> ''feuille'' -> ''compo_a'' -> ''A'' ->> ''n''', current_setting('t.c'))) = 'Adrien' then 'PASS  adverse : voit sa compo' else 'FAIL  adverse sa compo' end;
select _t(:'F', 'match avant lancement : refusé', $$select lancer_match_feuille(current_setting('t.f')::uuid, 1)::text$$, 'pas encore lancée');
select _t(:'W', 'remplacement avant lancement : refusé', $$select definir_remplacement(current_setting('t.f')::uuid, 'E', null, null)::text$$, 'Lancez d''abord');
select _t(:'F', 'joueur : ne lance pas la rencontre', $$select lancer_rencontre(current_setting('t.f')::uuid)::text$$, 'Seul le capitaine');
select _t(:'W', 'lancer la rencontre', $$select lancer_rencontre(current_setting('t.f')::uuid)::text$$);
select _t(:'W', 'annuler le lancement (rien joué)', $$select annuler_lancement_feuille(current_setting('t.f')::uuid)::text$$);
select _t(:'W', 'relancer', $$select lancer_rencontre(current_setting('t.f')::uuid)::text$$);
select _t(:'W', 'après lancement : compo adverse visible', $$select feuille_detail(current_setting('t.f')::uuid) -> 'feuille' -> 'compo_a' -> 'A' ->> 'n'$$);
select case when _anon(format($q$select enregistrer_compo(null, 'A', '{"A":{"n":"Autre"}}', %L)$q$, current_setting('t.c'))) like 'ERREUR%lancée%' then 'PASS  adverse : compo figée après lancement' else 'FAIL  adverse modifie après lancement' end;
select _t(:'W', 'compo complète', $$select coalesce(feuille_detail(current_setting('t.f')::uuid) -> 'feuille' ->> 'manque_a', 'complète')$$);

-- Matchs
select _t(:'G', 'hors équipe : ne lance pas', $$select lancer_match_feuille(current_setting('t.f')::uuid, 1)::text$$, 'Seuls les joueurs');
select _t(:'F', 'joueur : lance le match 1', $$select set_config('t.g1', lancer_match_feuille(current_setting('t.f')::uuid, 1)::text, false)$$);
select _t(:'F', 'partie : 501, 3 manches, A commence, sans guide, ligue', $$select (1 / ((select variant = '501' and legs_kind = 'best_of' and legs_n = 3 and first_side = 1 and not show_checkout and match_type = 'ligue' and mode = 'single' from games where id = current_setting('t.g1')::uuid))::int)::text$$);
select _t(:'F', 'joueurs : Adrien (A) contre Franck (F)', $$select string_agg(side || ':' || coalesce(guest_name, (select first_name from profiles where id = profile_id)), ' ' order by side) from game_players where game_id = current_setting('t.g1')::uuid$$);
select _t(:'F', 'Franck occupé : match 6 refusé', $$select lancer_match_feuille(current_setting('t.f')::uuid, 6)::text$$, 'joue déjà');
select _t(:'F', 'match 2 (B-E) : E commence', $$with l as (select lancer_match_feuille(current_setting('t.f')::uuid, 2) id) select first_side::text from games g join l on l.id = g.id$$);
select _t(:'F', 'création directe interdite', format($$insert into games (created_by, variant, start_score, mode, legs_kind, legs_n, feuille_match_id) values (%L, '501', 501, 'single', 'best_of', 3, %L) returning id$$, :'F', (select id from feuille_matchs where numero = 5)), 'se lance depuis la feuille');
-- Franck gagne 2-0 dans le scorer
insert into visits (game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double)
select current_setting('t.g1')::uuid, 1, l, 1, 2, 40, 40, true, 2, 1 from generate_series(1, 2) l;
update games set status = 'finished', winner_side = 2, finished_at = now() where id = current_setting('t.g1')::uuid;
select _t(:'G', 'hors équipe : ne valide pas', $$select valider_match_feuille(current_setting('t.g1')::uuid)::text$$, 'Seuls la personne');
select _t(:'F', 'valide le match 1', $$select valider_match_feuille(current_setting('t.g1')::uuid)::text$$);
select _v('match 1 : 0-2', $$select manches_a || '-' || manches_e || ' ' || statut from feuille_matchs where numero = 1$$, '0-2 termine');
select _t(:'F', 'partie verrouillée', $$insert into visits (game_id, set_no, leg_no, visit_no, side, score, remaining_before) values (current_setting('t.g1')::uuid, 1, 3, 1, 1, 60, 501) returning id::text$$, 'ne peut plus être modifiée');
-- Abandon du match 2 : il redevient à jouer
select set_config('t.g2', (select game_id::text from feuille_matchs where numero = 2), false);
select _t(:'F', 'abandon du match 2', $$update games set status = 'abandoned' where id = current_setting('t.g2')::uuid returning 'ok'$$);
select _v('match 2 à jouer', $$select statut from feuille_matchs where numero = 2$$, 'a_jouer');
-- Double
select _t(:'W', 'match 9 : double, 4 joueurs', $$with l as (select lancer_match_feuille(current_setting('t.f')::uuid, 9) id) select mode || ' ' || (select count(*) from game_players p where p.game_id = g.id) from games g join l on l.id = g.id$$);
select _v('double : noms des paires = équipes', $$select string_agg(name, ' / ' order by side) from game_sides where game_id = (select game_id from feuille_matchs where numero = 9)$$, 'Darting Test / Dolina 2');

-- Saisie rapide
select _t(:'F', 'score 3-0 refusé', $$select saisir_resultat_feuille(current_setting('t.f')::uuid, 3, 2, 2)::text$$, 'Score impossible');
select _t(:'F', 'match en cours : saisie refusée', $$select saisir_resultat_feuille(current_setting('t.f')::uuid, 9, 2, 0)::text$$, 'en cours dans le scorer');
select _t(:'F', 'match 3 : 2-1', $$select saisir_resultat_feuille(current_setting('t.f')::uuid, 3, 2, 1)::text$$);
select _t(:'F', 'match scoré : saisie refusée', $$select saisir_resultat_feuille(current_setting('t.f')::uuid, 1, 2, 0)::text$$, 'remettez-le à jouer');

-- Remplacement
select _t(:'W', 'annuler le lancement après un match : refusé', $$select annuler_lancement_feuille(current_setting('t.f')::uuid)::text$$, 'ne peut plus');
select _t(:'W', 'remplacement sur un match joué refusé', $$select definir_remplacement(current_setting('t.f')::uuid, 'A', 'A', 0)::text$$, 'déjà commencé');
select _t(:'W', 'Y remplace D après le match 10', $$select definir_remplacement(current_setting('t.f')::uuid, 'A', 'D', 10)::text$$);
select _v('match 14 : Loïc à la place d''Alan', $$select feuille_joueurs_match(f, 14) -> 'a' -> 0 ->> 'n' from feuilles_match f$$, 'Loïc');
select _v('match 8 : Alan joue encore', $$select feuille_joueurs_match(f, 8) -> 'a' -> 0 ->> 'n' from feuilles_match f$$, 'Alan');
select _v('match 20 (double A2) : Loïc et Romain', $$select string_agg(x ->> 'n', ' et ') from feuilles_match f, jsonb_array_elements(feuille_joueurs_match(f, 20) -> 'a') x$$, 'Loïc et Romain');
select _t(:'W', 'remplacement côté E avec Z', $$select definir_remplacement(current_setting('t.f')::uuid, 'E', 'E', 12)::text$$);
select _v('match 16 : Rempl Z remplace Will', $$select feuille_joueurs_match(f, 16) -> 'e' -> 0 ->> 'n' from feuilles_match f$$, 'Rempl Z');
select _t(:'F', 'joueur : pas de remplacement', $$select definir_remplacement(current_setting('t.f')::uuid, 'E', null, null)::text$$, 'Seul le capitaine');

-- Remettre à jouer
select _t(:'W', 'remettre le match 9 à jouer (partie effacée)', $$select remettre_match_feuille(current_setting('t.f')::uuid, 9)::text$$);
select _v('match 9 à jouer, plus de partie', $$select statut || ' ' || (select count(*) from games where feuille_match_id = m.id) from feuille_matchs m where numero = 9$$, 'a_jouer 0');

-- Validation
select _t(:'W', 'validation avant la fin refusée', $$select valider_feuille(current_setting('t.f')::uuid, 's', 's')::text$$, 'pas terminés');
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  for n in select numero from feuille_matchs where statut = 'a_jouer' order by numero loop
    perform saisir_resultat_feuille(current_setting('t.f')::uuid, n, case when n % 3 = 0 then 2 else 0 end, case when n % 3 = 0 then 1 else 2 end);
  end loop; end $$;
select _t(:'F', 'joueur : ne valide pas la feuille', $$select valider_feuille(current_setting('t.f')::uuid, 's', 's')::text$$, 'Seul le capitaine');
select _t(:'W', 'sans signature : refusé', $$select valider_feuille(current_setting('t.f')::uuid, 'data:a', '')::text$$, 'doivent signer');
select _t(:'W', 'valide : score de la rencontre', $$select valider_feuille(current_setting('t.f')::uuid, 'data:a', 'data:e') ->> 'score_nous'$$);
select _v('calendrier : score reporté', $$select score_nous || '-' || score_eux from rencontres where id = current_setting('t.r')::uuid$$, (select count(*) filter (where manches_e > manches_a) || '-' || count(*) filter (where manches_a > manches_e) from feuille_matchs));
select _v('article publié, lié à l''équipe', $$select (published and team_id = (select team_id from feuilles_match))::text from articles a where id = (select article_id from feuilles_match)$$, 'true');
select title from articles where id = (select article_id from feuilles_match);
select _t(:'W', 'feuille validée : correction refusée', $$select remettre_match_feuille(current_setting('t.f')::uuid, 3)::text$$, 'rouvrez-la');
select _t(:'W', 'rouvrir', $$select rouvrir_feuille(current_setting('t.f')::uuid)::text$$);
select _v('rouverte : signatures effacées', $$select statut || ' ' || coalesce(signature_a, 'vide') from feuilles_match$$, 'en_cours vide');
select _t(:'W', 'supprimer la feuille', $$select supprimer_feuille(current_setting('t.f')::uuid)::text$$);
select _v('parties jouées gardées, feuille effacée', $$select (select count(*) from games where id = current_setting('t.g1')::uuid) || ' ' || (select count(*) from feuille_matchs)$$, '1 0');
-- 064 : à domicile, notre équipe est toujours A
insert into rencontres (team_id, date_match, adversaire, domicile) select id, '2026-11-20', 'Recoit Test', true from teams where name = 'Dolina 2';
select _t(:'W', 'domicile : feuille ouverte en A (même si E demandé)', $$select (select notre_camp from feuilles_match where id = creer_feuille((select id from rencontres where adversaire = 'Recoit Test'), 'E', 2))$$);
