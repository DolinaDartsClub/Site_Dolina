\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\pset tuples_only on
\pset format unaligned
create or replace function _fab3(nom text, fmt text, membres uuid[], invites int, q int default null, troisieme boolean default false)
returns uuid language plpgsql as $$
declare tid uuid; x uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into tournaments(name, format, max_participants, status, pool_qualifiers, third_place, created_by)
  values (nom, fmt, 64, 'open', q, troisieme, '22222222-2222-2222-2222-222222222222') returning id into tid;
  foreach x in array membres loop insert into tournament_entries(tournament_id, profile_id) values (tid, x); end loop;
  for i in 1..invites loop insert into tournament_entries(tournament_id, guest_name) values (tid, 'Inv' || lpad(i::text,2,'0')); end loop;
  return tid;
end $$;
create or replace function _jouer(g uuid, v int, lv int, ll int) returns void language plpgsql as $$
declare k int := 0; p int := case when v = 1 then 2 else 1 end;
begin
  for i in 1..ll loop k := k + 1; insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (g, 1, k, 1, p, 40, 40, true, 2, 1); end loop;
  for i in 1..lv loop k := k + 1; insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_checkout, darts_used, darts_at_double) values (g, 1, k, 1, v, 40, 40, true, 2, 1); end loop;
  update games set status = 'finished', winner_side = v, finished_at = now() where id = g;
end $$;
-- Joue (en tant que Will, organisateur) le match n°no : le camp v gagne
create or replace function _joue(tid uuid, no int, v int) returns void language plpgsql as $$
declare g uuid; mid uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select id into mid from tournament_matches where tournament_id = tid and match_no = no;
  g := lancer_match_tournoi(mid); perform _jouer(g, v, 2, 1); perform valider_match_tournoi(g);
end $$;
create or replace function _n(e uuid) returns text language sql as $$ select coalesce(nom_inscrit(x), '—') from tournament_entries x where x.id = e $$;
create or replace function _etat(tid uuid, no int) returns text language sql as $$
  select 'M' || match_no || ' ' || status || ' ' || coalesce(_n(entry_a),'—') || ' vs ' || coalesce(_n(entry_b),'—') || coalesce(' → ' || _n(winner_entry), '') from tournament_matches where tournament_id = tid and match_no = no $$;

create or replace function _id(tid uuid, no int) returns uuid language sql as $$ select id from tournament_matches where tournament_id = tid and match_no = no $$;
select set_config('t.k', _fab3('KO corrections', 'knockout', '{}', 8, null, true)::text, false);
select _t(:'W', 'lancer KO8', $$select lancer_tournoi(current_setting('t.k')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}')::text$$);
select _joue(current_setting('t.k')::uuid, n, 1) from generate_series(1, 4) n;
-- Format par tour
select _t(:'F', 'format d un tour : participant refusé', $$select definir_format_tour(current_setting('t.k')::uuid, 2, '{"variant":"501","legs_kind":"first_to","legs_n":3}')::text$$, 'Seul');
select _t(:'W', 'demi-finales en premier à 3', $$select definir_format_tour(current_setting('t.k')::uuid, 2, '{"variant":"501","legs_kind":"first_to","legs_n":3}')::text$$);
select _t(:'W', 'finale (et 3e place) au meilleur de 7', $$select definir_format_tour(current_setting('t.k')::uuid, 3, '{"variant":"501","legs_kind":"best_of","legs_n":7}')::text$$);
select _t(:'W', 'premier tour (déjà joué) : refusé', $$select definir_format_tour(current_setting('t.k')::uuid, 1, '{"variant":"501","legs_kind":"first_to","legs_n":3}')::text$$, 'déjà commencé');
select _t(:'W', 'format invalide refusé', $$select definir_format_tour(current_setting('t.k')::uuid, 2, '{"variant":"501","legs_kind":"best_of","legs_n":4}')::text$$, 'impair');
select _t(:'W', 'lancer la demi-finale M5', $$select set_config('t.g5', lancer_match_tournoi(_id(current_setting('t.k')::uuid, 5))::text, false)$$);
select _t(:'W', 'demi-finale lancée avec le nouveau format', $$select legs_kind || legs_n from games where id = current_setting('t.g5')::uuid$$);
-- Corriger le score
select _t(:'F', 'corriger : participant refusé', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 2), 2, 0)::text$$, 'Seul');
select _t(:'W', 'match non terminé refusé', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 6), 2, 0)::text$$, 'terminé');
select _t(:'W', 'égalité refusée', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 2), 1, 1)::text$$, 'égaux');
select _t(:'W', 'M2 : même vainqueur, score 2-0', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 2), 2, 0)::text$$);
select _t(:'W', 'M2 corrigé', $$select score_a || '-' || score_b || ' corrigé=' || (corrected_at is not null) from tournament_matches where id = _id(current_setting('t.k')::uuid, 2)$$);
select _t(:'W', 'M1 : vainqueur change alors que la demi M5 est en cours : refusé', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 1), 0, 2)::text$$, 'M5');
select _t(:'W', 'M1 : même vainqueur même si la suite a commencé : accepté', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 1), 2, 0)::text$$);
select 'avant : ' || _etat(current_setting('t.k')::uuid, 4) || ' | ' || _etat(current_setting('t.k')::uuid, 6);
select _t(:'W', 'M4 : le vainqueur change (demi M6 pas commencée)', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 4), 1, 2)::text$$);
select 'après : ' || _etat(current_setting('t.k')::uuid, 4) || ' | ' || _etat(current_setting('t.k')::uuid, 6);
-- Finir et corriger la finale d'un tournoi terminé (vainqueur change, rien après)
do $$ declare g uuid; begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select game_id into g from tournament_matches where id = _id(current_setting('t.k')::uuid, 5);
  perform _jouer(g, 1, 3, 0); perform valider_match_tournoi(g);
end $$;
select _joue(current_setting('t.k')::uuid, 6, 1);
select _joue(current_setting('t.k')::uuid, 7, 1);
select _joue(current_setting('t.k')::uuid, 8, 1);
select 'terminé : ' || status from tournaments where id = current_setting('t.k')::uuid;
select _t(:'W', 'finale : vainqueur inversé après la fin', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 7), 2, 4)::text$$);
select 'finale corrigée : ' || _etat(current_setting('t.k')::uuid, 7) || ' / ' || (select status from tournaments where id = current_setting('t.k')::uuid);
select _t(:'W', 'demi M5 : vainqueur inversé alors que finale et 3e place jouées : refusé', $$select corriger_score_match(_id(current_setting('t.k')::uuid, 5), 0, 3)::text$$, 'M7, M8');
-- Poules : correction du classement, refus après la phase finale, sets
select set_config('t.p', _fab3('Poules corr', 'pools', '{}', 4, 1)::text, false);
select _t(:'W', 'lancer poules en sets', $$select lancer_tournoi(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2,"sets_kind":"first_to","sets_n":2}', 2)::text$$);
select _joue(current_setting('t.p')::uuid, n, 1) from generate_series(1, 2) n;
select _t(:'W', 'sets sans manches : refusé', $$select corriger_score_match(_id(current_setting('t.p')::uuid, 1), 2, 1)::text$$, 'manches gagnées');
select _t(:'W', 'correction en sets avec manches', $$select corriger_score_match(_id(current_setting('t.p')::uuid, 1), 1, 2, 3, 4)::text$$);
select _t(:'W', 'classement mis à jour', $$select string_agg(c.rang || '.' || _n(c.entry_id) || '(' || c.points || 'pts,' || c.manches || 'm)', ' ' order by c.rang) from classement_poule(current_setting('t.p')::uuid, 1) c$$);
select _t(:'W', 'correction M1 : même vainqueur en sets', $$select corriger_score_match(_id(current_setting('t.p')::uuid, 1), 1, 2, 3, 4)::text$$);
select _t(:'W', 'phase finale', $$select lancer_phase_finale(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":3}')::text$$);
select _t(:'W', 'poule après phase finale : refusé', $$select corriger_score_match(_id(current_setting('t.p')::uuid, 2), 2, 0, 4, 0)::text$$, 'phase finale est lancée');
