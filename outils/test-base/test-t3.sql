\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
\pset tuples_only on
\pset format unaligned
-- Outils de test
create or replace function _fab3(nom text, fmt text, membres uuid[], invites int, q int default null, troisieme boolean default false)
returns uuid language plpgsql as $$
declare tid uuid; x uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into tournaments(name, format, max_participants, status, pool_qualifiers, third_place, created_by)
  values (nom, fmt, 64, 'open', q, troisieme, '22222222-2222-2222-2222-222222222222') returning id into tid;
  foreach x in array membres loop insert into tournament_entries(tournament_id, profile_id) values (tid, x); end loop;
  for i in 1..invites loop insert into tournament_entries(tournament_id, guest_name) values (tid, 'Inv' || i); end loop;
  return tid;
end $$;
-- Joue une partie dans la base (comme le scorer) : le camp v gagne lv manches à ll
create or replace function _jouer(g uuid, v int, lv int, ll int) returns void language plpgsql as $$
declare k int := 0; p int := case when v = 1 then 2 else 1 end;
begin
  for i in 1..ll loop k := k + 1; insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (g, 1, k, 1, p, 40, 40, true, 2, 1); end loop;
  for i in 1..lv loop k := k + 1; insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (g, 1, k, 1, v, 40, 40, true, 2, 1); end loop;
  update games set status = 'finished', winner_side = v, finished_at = now() where id = g;
end $$;
create or replace function _m(tid uuid, no int) returns uuid language sql as $$ select id from tournament_matches where tournament_id = tid and match_no = no $$;

-- ===== KO à 4 : Will (orga), Franck, Gérald, Tony ; 3e place
select set_config('t.ko', _fab3('KO4', 'knockout', array['33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111']::uuid[], 1, null, true)::text, false);
select _t(:'W', 'lancer KO4', $$select lancer_tournoi(current_setting('t.ko')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$);
select _t(:'W', 'match d attente non lançable', $$select lancer_match_tournoi(_m(current_setting('t.ko')::uuid, 3))::text$$, 'pas encore être joué');
select _t(:'W', 'partie de tournoi créée à la main refusée', $$insert into games(created_by, variant, start_score, mode, legs_kind, legs_n, tournament_match_id) values ('22222222-2222-2222-2222-222222222222','501',501,'single','best_of',3,_m(current_setting('t.ko')::uuid, 1)) returning id$$, 'depuis la page du tournoi');
select set_config('t.m1', _m(current_setting('t.ko')::uuid, 1)::text, false);
select _t(null, 'visiteur ne peut pas lancer', $$select lancer_match_tournoi(current_setting('t.m1')::uuid)::text$$, 'Seuls les participants');
select _t(:'F', 'Franck lance M1', $$select set_config('t.g1', lancer_match_tournoi(_m(current_setting('t.ko')::uuid, 1), 2)::text, false)$$);
select _t(:'G', 'second lancement de M1 refusé', $$select lancer_match_tournoi(_m(current_setting('t.ko')::uuid, 1))::text$$, 'déjà en cours');
select _t(:'F', 'partie créée : joueurs, format, premier', $$select g.variant || ' bo' || g.legs_n || ' premier=' || g.first_side || ' vis=' || g.visibility || ' joueurs=' || (select string_agg(display_name, ' / ' order by side) from game_players where game_id = g.id) from games g where id = current_setting('t.g1')::uuid$$);
select _t(:'F', 'Franck tient le score : partie modifiable', $$select (can_edit_game(current_setting('t.g1')::uuid))::text$$);
select _t(:'F', 'valider avant la fin refusé', $$select valider_match_tournoi(current_setting('t.g1')::uuid)::text$$, 'pas terminée');
select _jouer(current_setting('t.g1')::uuid, 1, 2, 1);
select _t(:'G', 'Gérald (autre participant) ne peut pas valider', $$select valider_match_tournoi(current_setting('t.g1')::uuid)::text$$, 'Seuls la personne');
select _t(:'F', 'Franck valide', $$select valider_match_tournoi(current_setting('t.g1')::uuid)::text$$);
select _t(:'F', 'double validation sans effet', $$select valider_match_tournoi(current_setting('t.g1')::uuid)::text$$);
select _t(:'F', 'M1 : score et vainqueur', $$select status || ' ' || score_a || '-' || score_b || ' vainqueur=' || (select nom_inscrit(e) from tournament_entries e where e.id = winner_entry) from tournament_matches where id = _m(current_setting('t.ko')::uuid, 1)$$);
select _t(:'F', 'finale : vainqueur placé', $$select coalesce((select nom_inscrit(e) from tournament_entries e where e.id = entry_a), '—') || ' vs ' || coalesce((select nom_inscrit(e) from tournament_entries e where e.id = entry_b), '—') || ' ' || status from tournament_matches where tournament_id = current_setting('t.ko')::uuid and round_no = 2 and not is_third_place$$);
select _t(:'F', '3e place : perdant placé', $$select coalesce((select nom_inscrit(e) from tournament_entries e where e.id = entry_a), '—') || ' vs ' || coalesce((select nom_inscrit(e) from tournament_entries e where e.id = entry_b), '—') from tournament_matches where tournament_id = current_setting('t.ko')::uuid and is_third_place$$);
select _t(:'F', 'après validation : annuler une volée refusé', $$delete from visits where id = (select max(id) from visits where game_id = current_setting('t.g1')::uuid) returning id$$, 'Résultat validé');
select _t(:'F', 'après validation : remettre la partie en cours refusé', $$update games set status = 'live', winner_side = null where id = current_setting('t.g1')::uuid returning id$$, 'Résultat validé');
-- M2 : Tony lance ; Tony ne peut pas en lancer un 2e en même temps (pas d'autre match prêt pour lui ici) ; abandon → à jouer
select _t(:'T', 'Tony lance M2', $$select set_config('t.g2', lancer_match_tournoi(_m(current_setting('t.ko')::uuid, 2))::text, false)$$);
select _t(:'T', 'abandon (suppression de la partie)', $$with d as (delete from games where id = current_setting('t.g2')::uuid returning id) select count(*)::text from d$$);
select _t(:'T', 'après abandon : match à jouer', $$select status from tournament_matches where id = _m(current_setting('t.ko')::uuid, 2)$$);
select _t(:'T', 'relancer M2 après abandon', $$select set_config('t.g2', lancer_match_tournoi(_m(current_setting('t.ko')::uuid, 2))::text, false)$$);
select _jouer(current_setting('t.g2')::uuid, 2, 2, 0);
select _t(:'W', 'l organisateur valide M2', $$select valider_match_tournoi(current_setting('t.g2')::uuid)::text$$);
select _t(:'W', 'finale et 3e place prêtes', $$select string_agg(status, ',' order by match_no) from tournament_matches where tournament_id = current_setting('t.ko')::uuid and round_no = 2$$);
-- Correction : remettre M2 à jouer alors que la finale n'a pas commencé
select _t(:'F', 'participant ne peut pas corriger', $$select reinitialiser_match(_m(current_setting('t.ko')::uuid, 2))::text$$, 'Seul l''organisateur');
select _t(:'W', 'organisateur remet M2 à jouer', $$select reinitialiser_match(_m(current_setting('t.ko')::uuid, 2))::text$$);
select _t(:'W', 'M2 à jouer, finale en attente, partie effacée', $$select (select status from tournament_matches where id = _m(current_setting('t.ko')::uuid, 2)) || ' / ' || (select status from tournament_matches where tournament_id = current_setting('t.ko')::uuid and round_no = 2 and not is_third_place) || ' / ' || (select count(*) from games where id = current_setting('t.g2')::uuid)$$);
-- Forfait sur M2
select _t(:'W', 'forfait de l invité (ou de Tony) sur M2', $$select forfait_match(_m(current_setting('t.ko')::uuid, 2), (select entry_b from tournament_matches where id = _m(current_setting('t.ko')::uuid, 2)))::text$$);
select _t(:'W', 'M2 gagné par forfait, finale prête', $$select (select (forfeit)::text || ' ' || status from tournament_matches where id = _m(current_setting('t.ko')::uuid, 2)) || ' / ' || (select status from tournament_matches where tournament_id = current_setting('t.ko')::uuid and round_no = 2 and not is_third_place)$$);
-- Corriger M1 après le début de la finale : refusé
select _t(:'F', 'Franck lance la finale', $$select set_config('t.gf', lancer_match_tournoi((select id from tournament_matches where tournament_id = current_setting('t.ko')::uuid and round_no = 2 and not is_third_place))::text, false)$$);
select _t(:'W', 'corriger M1 alors que la finale a commencé : refusé', $$select reinitialiser_match(_m(current_setting('t.ko')::uuid, 1))::text$$, 'match suivant a déjà commencé');
select _t(:'G', 'Gérald lance la 3e place (en parallèle)', $$select set_config('t.g3', lancer_match_tournoi((select id from tournament_matches where tournament_id = current_setting('t.ko')::uuid and is_third_place))::text, false)$$);
select _jouer(current_setting('t.gf')::uuid, 1, 2, 0);
select _t(:'F', 'valider la finale', $$select valider_match_tournoi(current_setting('t.gf')::uuid)::text$$);
select _t(:'F', 'tournoi pas encore terminé (3e place en cours)', $$select status from tournaments where id = current_setting('t.ko')::uuid$$);
select _jouer(current_setting('t.g3')::uuid, 2, 2, 1);
select _t(:'G', 'valider la 3e place', $$select valider_match_tournoi(current_setting('t.g3')::uuid)::text$$);
select _t(:'G', 'tournoi terminé', $$select status from tournaments where id = current_setting('t.ko')::uuid$$);

-- ===== Poules : 6 joueurs (Franck, Gérald, Tony + 3 invités), 2 poules de 3, 2 qualifiés
select set_config('t.p', _fab3('Poules6', 'pools', array['33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111']::uuid[], 3, 2)::text, false);
select _t(:'W', 'lancer poules (2 poules)', $$select lancer_tournoi(current_setting('t.p')::uuid, '{"variant":"301","legs_kind":"first_to","legs_n":2}', 2)::text$$);
select _t(:'W', 'phase finale avant la fin des poules : refusé', $$select lancer_phase_finale(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":5}')::text$$, 'Tous les matchs de poule');
-- Un joueur ne peut pas jouer deux matchs à la fois
select set_config('t.pm1', (select id::text from tournament_matches where tournament_id = current_setting('t.p')::uuid and pool_no = 1 order by match_no limit 1), false);
select _t(:'W', 'lancer un match de poule', $$select set_config('t.pg1', lancer_match_tournoi(current_setting('t.pm1')::uuid)::text, false)$$);
select _t(:'W', 'même joueur dans un 2e match simultané : refusé', $$select lancer_match_tournoi((select o.id from tournament_matches o, tournament_matches m where m.id = current_setting('t.pm1')::uuid and o.tournament_id = m.tournament_id and o.id <> m.id and o.status = 'ready' and (o.entry_a in (m.entry_a, m.entry_b) or o.entry_b in (m.entry_a, m.entry_b)) limit 1))::text$$, 'a déjà un match en cours');
select _t(:'W', 'autre poule en parallèle : accepté', $$select lancer_match_tournoi((select id from tournament_matches where tournament_id = current_setting('t.p')::uuid and pool_no = 2 and status = 'ready' order by match_no limit 1))::text$$);
-- Jouer toutes les poules : le premier inscrit de chaque match gagne 2-1 (en tant qu'organisateur)
do $$
declare m record; g uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  for m in select * from tournament_matches where tournament_id = current_setting('t.p')::uuid order by match_no loop
    select game_id into g from tournament_matches where id = m.id;
    if g is null then g := lancer_match_tournoi(m.id); end if;
    perform _jouer(g, 1, 2, 1);
    perform valider_match_tournoi(g);
  end loop;
end $$;
select _t(:'W', 'classements de poule', $$select string_agg('P' || p || ': ' || (select string_agg(c.rang || '.' || (select nom_inscrit(e) from tournament_entries e where e.id = c.entry_id) || '(' || c.points || 'pts,' || c.manches || 'm)', ' ' order by c.rang) from classement_poule(current_setting('t.p')::uuid, p) c), ' | ') from generate_series(1, 2) p$$);
select _t(:'W', 'lancer la phase finale (bo5)', $$select lancer_phase_finale(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":5}')::text$$);
select _t(:'W', 'phase finale : croisement 1er A / 2e B', $$select string_agg((select nom_inscrit(e) || '[' || e.pool_no || ']' from tournament_entries e where e.id = entry_a) || ' vs ' || (select nom_inscrit(e) || '[' || e.pool_no || ']' from tournament_entries e where e.id = entry_b), ' ; ' order by position) from tournament_matches where tournament_id = current_setting('t.p')::uuid and phase = 'final' and round_no = 1$$);
select _t(:'W', 'aucun croisement de même poule au 1er tour', $$select count(*)::text from tournament_matches m join tournament_entries a on a.id = m.entry_a join tournament_entries b on b.id = m.entry_b where m.tournament_id = current_setting('t.p')::uuid and m.phase = 'final' and m.round_no = 1 and a.pool_no = b.pool_no$$);
select _t(:'W', 'relancer la phase finale : refusé', $$select lancer_phase_finale(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":5}')::text$$, 'déjà lancée');
select _t(:'W', 'corriger un match de poule après la phase finale : refusé', $$select reinitialiser_match(current_setting('t.pm1')::uuid)::text$$, 'phase finale est lancée');
select _t(:'W', 'lancer un match de phase finale', $$select set_config('t.pf', lancer_match_tournoi((select id from tournament_matches where tournament_id = current_setting('t.p')::uuid and phase = 'final' and status = 'ready' order by match_no limit 1))::text, false)$$);
select _t(:'W', 'format de la phase finale appliqué', $$select legs_kind || legs_n from games where id = current_setting('t.pf')::uuid$$);
