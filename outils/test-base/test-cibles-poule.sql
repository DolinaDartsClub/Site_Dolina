-- Script 042 : plusieurs cibles par poule
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
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
-- n-ième match prêt de la poule 1 dont aucun joueur n'est déjà en cours
create or replace function _libre(tid uuid, n int) returns uuid language sql as $$
  select o.id from tournament_matches o
  where o.tournament_id = tid and o.pool_no = 1 and o.status = 'ready'
    and not exists (select 1 from tournament_matches l where l.tournament_id = tid and l.status = 'live'
      and (o.entry_a in (l.entry_a, l.entry_b) or o.entry_b in (l.entry_a, l.entry_b)))
  order by o.round_no, o.match_no offset n - 1 limit 1 $$;

-- Une seule poule de 6 : Franck, Tony + 4 invités
select set_config('t.c', _fab3('Cibles', 'pools', array[:'F',:'T']::uuid[], 4, 2)::text, false);
select _t(:'W', 'lancer (1 poule de 6)', $$select lancer_tournoi(current_setting('t.c')::uuid, '{"variant":"301","legs_kind":"first_to","legs_n":2}', 1)::text$$);
select _t(:'W', 'par défaut : 1 cible par poule', $$select (1 / ((select cibles_par_poule from tournaments where id = current_setting('t.c')::uuid) = 1 and (tournoi_detail(current_setting('t.c')::uuid)->'tournoi'->>'cibles_par_poule') = '1')::int)::text$$);
select _t(:'W', '1er match', $$select lancer_match_tournoi(_libre(current_setting('t.c')::uuid, 1))::text$$);
select _t(:'W', '2e match (autres joueurs), 1 cible : refusé', $$select lancer_match_tournoi(_libre(current_setting('t.c')::uuid, 1))::text$$, 'La cible de la poule A occupée');
-- Réglage : réservé à l'organisateur, entre 1 et 8
select _t(:'F', 'participant ne peut pas changer les cibles', $$select definir_cibles_poule(current_setting('t.c')::uuid, 2)::text$$, 'Seul l''organisateur');
select _t(:'W', '9 cibles refusé', $$select definir_cibles_poule(current_setting('t.c')::uuid, 9)::text$$, 'entre 1 et 8');
select _t(:'W', 'passer à 2 cibles', $$select definir_cibles_poule(current_setting('t.c')::uuid, 2)::text$$);
select _t(:'F', 'le participant voit 2 cibles', $$select (1 / (tournoi_detail(current_setting('t.c')::uuid)->'tournoi'->>'cibles_par_poule' = '2')::int)::text$$);
select _t(:'W', '2e match en même temps : accepté', $$select lancer_match_tournoi(_libre(current_setting('t.c')::uuid, 1))::text$$);
select _t(:'W', '3e match, 2 cibles prises : refusé', $$select lancer_match_tournoi(_libre(current_setting('t.c')::uuid, 1))::text$$, 'Les 2 cibles de la poule A occupées');
-- Un joueur ne joue toujours qu'un match à la fois, même avec des cibles libres
select _t(:'W', 'passer à 3 cibles', $$select definir_cibles_poule(current_setting('t.c')::uuid, 3)::text$$);
select _t(:'W', 'match d un joueur déjà en cours : refusé', $$select lancer_match_tournoi((select o.id from tournament_matches o, tournament_matches l where o.tournament_id = current_setting('t.c')::uuid and l.tournament_id = o.tournament_id and l.status = 'live' and o.status = 'ready' and o.entry_a in (l.entry_a, l.entry_b) limit 1))::text$$, 'déjà un match en cours');
select _t(:'W', '3e match en même temps : accepté', $$select lancer_match_tournoi(_libre(current_setting('t.c')::uuid, 1))::text$$);
select _t(:'W', '3 matchs en cours dans la poule', $$select (1 / (count(*) = 3)::int)::text from tournament_matches where tournament_id = current_setting('t.c')::uuid and status = 'live'$$);
-- Revenir à 1 cible pendant que 3 matchs tournent : les matchs en cours continuent, on ne lance plus rien
select _t(:'W', 'revenir à 1 cible', $$select definir_cibles_poule(current_setting('t.c')::uuid, 1)::text$$);
select _t(:'W', 'en cours conservés', $$select (1 / (count(*) = 3)::int)::text from tournament_matches where tournament_id = current_setting('t.c')::uuid and status = 'live'$$);

delete from tournaments where id = current_setting('t.c')::uuid;
drop function _libre(uuid, int);
