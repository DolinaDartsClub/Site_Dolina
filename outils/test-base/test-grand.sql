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

\echo ===== KO 16 joueurs
select set_config('t.k', _fab3('Grand KO', 'knockout', '{}', 16, null, true)::text, false);
select _t(:'W', 'lancer KO16', $$select lancer_tournoi(current_setting('t.k')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}')::text$$);
-- Premier tour complet (M1 à M8) : le camp 1 gagne
select _joue(current_setting('t.k')::uuid, n, 1) from generate_series(1, 8) n;
select _etat(current_setting('t.k')::uuid, 9) || ' | ' || _etat(current_setting('t.k')::uuid, 10);
\echo -- Erreur sur M3 (le mauvais joueur a été validé) : les quarts M10 pas commencé
select _t(:'W', 'corriger M3 (quart M10 pas commencé)', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.k')::uuid and match_no = 3))::text$$);
select _etat(current_setting('t.k')::uuid, 3) || ' | ' || _etat(current_setting('t.k')::uuid, 10);
select _joue(current_setting('t.k')::uuid, 3, 2);
select 'après rejeu : ' || _etat(current_setting('t.k')::uuid, 3) || ' | ' || _etat(current_setting('t.k')::uuid, 10);
\echo -- Le quart M9 se joue ; on veut corriger M1 ensuite
select _joue(current_setting('t.k')::uuid, 9, 1);
select _t(:'W', 'corriger M1 alors que le quart M9 est validé : refusé', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.k')::uuid and match_no = 1))::text$$, 'suivant a déjà commencé');
select _t(:'W', 'corriger d abord M9 (demi-finale pas commencée)', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.k')::uuid and match_no = 9))::text$$);
select _t(:'W', 'puis corriger M1', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.k')::uuid and match_no = 1))::text$$);
select _etat(current_setting('t.k')::uuid, 1) || ' | ' || _etat(current_setting('t.k')::uuid, 9);
select _t(:'F', 'Franck (non organisateur) ne peut pas corriger', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.k')::uuid and match_no = 2))::text$$, 'Seul');
\echo -- Finir le tournoi puis corriger la finale
select _joue(current_setting('t.k')::uuid, 1, 2);
select _joue(current_setting('t.k')::uuid, n, 1) from generate_series(9, 14) n;
select 'finale : ' || _etat(current_setting('t.k')::uuid, 15) || ' | 3e : ' || _etat(current_setting('t.k')::uuid, 16);
select _joue(current_setting('t.k')::uuid, 15, 1);
select _joue(current_setting('t.k')::uuid, 16, 2);
select 'statut : ' || status from tournaments where id = current_setting('t.k')::uuid;
select _t(:'W', 'corriger la finale d un tournoi terminé', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.k')::uuid and match_no = 15))::text$$);
select 'statut après correction : ' || status from tournaments where id = current_setting('t.k')::uuid;
select _joue(current_setting('t.k')::uuid, 15, 2);
select 'finale rejouée : ' || _etat(current_setting('t.k')::uuid, 15) || ' | statut : ' || (select status from tournaments where id = current_setting('t.k')::uuid);

\echo ===== Poules 13 joueurs, 4 poules, 2 qualifiés
select set_config('t.p', _fab3('Grandes poules', 'pools', '{}', 13, 2)::text, false);
select _t(:'W', 'lancer poules', $$select lancer_tournoi(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 4)::text$$);
select _joue(current_setting('t.p')::uuid, n, 1) from generate_series(1, 15) n;
select 'poule A avant : ' || (select string_agg(c.rang || '.' || _n(c.entry_id) || '(' || c.points || ')', ' ' order by c.rang) from classement_poule(current_setting('t.p')::uuid, 1) c);
select _t(:'W', 'corriger M1 (poule)', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.p')::uuid and match_no = 1))::text$$);
select _joue(current_setting('t.p')::uuid, 1, 2);
select 'poule A après : ' || (select string_agg(c.rang || '.' || _n(c.entry_id) || '(' || c.points || ')', ' ' order by c.rang) from classement_poule(current_setting('t.p')::uuid, 1) c);
select _t(:'W', 'forfait impossible sur un match déjà joué', $$select forfait_match((select id from tournament_matches where tournament_id = current_setting('t.p')::uuid and match_no = 2), (select entry_a from tournament_matches where tournament_id = current_setting('t.p')::uuid and match_no = 2))::text$$, 'à jouer ou en cours');
select _t(:'W', 'lancer la phase finale', $$select lancer_phase_finale(current_setting('t.p')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$);
select 'phase finale (1er tour) : ' || (select string_agg(_n(entry_a) || ' vs ' || _n(entry_b), ' ; ' order by position) from tournament_matches where tournament_id = current_setting('t.p')::uuid and phase = 'final' and round_no = 1);
select _t(:'W', 'corriger une poule après la phase finale : refusé', $$select reinitialiser_match((select id from tournament_matches where tournament_id = current_setting('t.p')::uuid and match_no = 2))::text$$, 'phase finale est lancée');
