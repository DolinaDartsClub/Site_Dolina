-- Script 043 : cibles de la phase finale
\set T '11111111-1111-1111-1111-111111111111'
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
  for i in 1..invites loop insert into tournament_entries(tournament_id, guest_name) values (tid, 'Inv' || i); end loop;
  return tid;
end $$;
create or replace function _pret(tid uuid) returns uuid language sql as $$
  select id from tournament_matches where tournament_id = tid and status = 'ready' order by round_no, match_no limit 1 $$;

-- Élimination directe à 8 : Franck, Tony + 6 invités → 4 matchs au 1er tour
select set_config('t.k', _fab3('CiblesKO', 'knockout', array[:'F',:'T']::uuid[], 6)::text, false);
select _t(:'W', 'lancer KO8', $$select lancer_tournoi(current_setting('t.k')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$);
select _t(:'W', 'par défaut : sans limite', $$select (1 / ((select cibles_finale from tournaments where id = current_setting('t.k')::uuid) is null and (tournoi_detail(current_setting('t.k')::uuid)->'tournoi'->>'cibles_finale') is null)::int)::text$$);
select _t(:'W', 'match 1', $$select lancer_match_tournoi(_pret(current_setting('t.k')::uuid))::text$$);
select _t(:'W', 'match 2 en même temps (sans limite)', $$select lancer_match_tournoi(_pret(current_setting('t.k')::uuid))::text$$);
select _t(:'F', 'participant ne peut pas régler', $$select definir_cibles_finale(current_setting('t.k')::uuid, 3)::text$$, 'Seul l''organisateur');
select _t(:'W', '17 cibles refusé', $$select definir_cibles_finale(current_setting('t.k')::uuid, 17)::text$$, 'entre 1 et 16');
select _t(:'W', 'régler 2 cibles', $$select definir_cibles_finale(current_setting('t.k')::uuid, 2)::text$$);
select _t(:'F', 'le participant voit 2 cibles', $$select (1 / (tournoi_detail(current_setting('t.k')::uuid)->'tournoi'->>'cibles_finale' = '2')::int)::text$$);
select _t(:'W', 'match 3, 2 cibles prises : refusé', $$select lancer_match_tournoi(_pret(current_setting('t.k')::uuid))::text$$, 'Les 2 cibles de la phase finale occupées');
select _t(:'W', 'régler 3 cibles', $$select definir_cibles_finale(current_setting('t.k')::uuid, 3)::text$$);
select _t(:'W', 'match 3 : accepté', $$select lancer_match_tournoi(_pret(current_setting('t.k')::uuid))::text$$);
select _t(:'W', 'match 4, 3 cibles prises : refusé', $$select lancer_match_tournoi(_pret(current_setting('t.k')::uuid))::text$$, 'Les 3 cibles');
select _t(:'W', 'sans limite (0)', $$select definir_cibles_finale(current_setting('t.k')::uuid, 0)::text$$);
select _t(:'W', 'sans limite enregistré', $$select (1 / ((select cibles_finale from tournaments where id = current_setting('t.k')::uuid) is null)::int)::text$$);
select _t(:'W', 'match 4 : accepté', $$select lancer_match_tournoi(_pret(current_setting('t.k')::uuid))::text$$);
select _t(:'W', '1 cible', $$select definir_cibles_finale(current_setting('t.k')::uuid, 1)::text$$);
select _t(:'W', '4 matchs toujours en cours', $$select (1 / (count(*) = 4)::int)::text from tournament_matches where tournament_id = current_setting('t.k')::uuid and status = 'live'$$);
-- Les poules ne sont pas concernées par le réglage de la phase finale
select set_config('t.p', _fab3('CiblesP', 'pools', array[:'F',:'T']::uuid[], 4, 2)::text, false);
select _t(:'W', 'lancer poule de 6', $$select lancer_tournoi(current_setting('t.p')::uuid, '{"variant":"301","legs_kind":"first_to","legs_n":2}', 1)::text$$);
select _t(:'W', 'finale à 1 cible, poule à 2 cibles', $$select definir_cibles_finale(current_setting('t.p')::uuid, 1)::text || definir_cibles_poule(current_setting('t.p')::uuid, 2)::text$$);
select _t(:'W', 'poule : match 1', $$select lancer_match_tournoi(_pret(current_setting('t.p')::uuid))::text$$);
select _t(:'W', 'poule : match 2 (la limite finale ne compte pas)', $$select lancer_match_tournoi((select o.id from tournament_matches o where o.tournament_id = current_setting('t.p')::uuid and o.status = 'ready' and not exists (select 1 from tournament_matches l where l.tournament_id = o.tournament_id and l.status = 'live' and (o.entry_a in (l.entry_a, l.entry_b) or o.entry_b in (l.entry_a, l.entry_b))) order by o.round_no, o.match_no limit 1))::text$$);

delete from tournaments where id in (current_setting('t.k')::uuid, current_setting('t.p')::uuid);
drop function _pret(uuid);
