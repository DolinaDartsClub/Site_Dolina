\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\pset tuples_only on
\pset format unaligned
-- Fabrique : tournoi de Will avec n invités
create or replace function _fab(nom text, fmt text, n int, q int default null, troisieme boolean default false)
returns uuid language plpgsql as $$
declare tid uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into tournaments(name, format, max_participants, status, pool_qualifiers, third_place, created_by)
  values (nom, fmt, 64, 'open', q, troisieme, '22222222-2222-2222-2222-222222222222') returning id into tid;
  for i in 1..n loop insert into tournament_entries(tournament_id, guest_name) values (tid, 'J' || lpad(i::text, 2, '0')); end loop;
  return tid;
end $$;
select set_config('t.ko5', _fab('KO 5', 'knockout', 5)::text, false);
select set_config('t.ko8', _fab('KO 8', 'knockout', 8, null, true)::text, false);
select set_config('t.ko13', _fab('KO 13', 'knockout', 13)::text, false);
select set_config('t.ko2', _fab('KO 2', 'knockout', 2)::text, false);
select set_config('t.p13', _fab('Poules 13', 'pools', 13, 2)::text, false);
select set_config('t.p5', _fab('Poules 5', 'pools', 5, 3)::text, false);
select set_config('t.ko1', _fab('KO 1', 'knockout', 1)::text, false);
-- Droits et contrôles
select _t(:'F', 'non-organisateur ne peut pas lancer', $$select lancer_tournoi(current_setting('t.ko5')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$, 'Seul l''organisateur');
select _t(:'W', 'format invalide (manches paires en best of)', $$select lancer_tournoi(current_setting('t.ko5')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":4}')::text$$, 'impair');
select _t(:'W', 'jeu manquant', $$select lancer_tournoi(current_setting('t.ko5')::uuid, '{"legs_kind":"best_of","legs_n":3}')::text$$, 'Choisissez le jeu');
select _t(:'W', 'score libre sans score', $$select lancer_tournoi(current_setting('t.ko5')::uuid, '{"variant":"libre","legs_kind":"first_to","legs_n":2}')::text$$, 'score de départ');
select _t(:'W', 'KO avec 1 inscrit refusé', $$select lancer_tournoi(current_setting('t.ko1')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$, 'au moins 2');
select _t(:'W', 'appel direct de creer_arbre interdit', $$select creer_arbre(current_setting('t.ko1')::uuid, '{}', 1, false)::text$$, 'permission denied');
select _t(:'W', 'écriture directe dans les matchs interdite', $$insert into tournament_matches(tournament_id, match_no, phase, round_no) values (current_setting('t.ko5')::uuid, 99, 'final', 1) returning id$$, 'row-level security');
-- Lancements
select _t(:'W', 'lancer KO 5', $$select lancer_tournoi(current_setting('t.ko5')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$);
select _t(:'W', 'relancer refusé', $$select lancer_tournoi(current_setting('t.ko5')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}')::text$$, 'déjà lancé');
select _t(:'W', 'lancer KO 8 (+3e place)', $$select lancer_tournoi(current_setting('t.ko8')::uuid, '{"variant":"301","legs_kind":"first_to","legs_n":2,"sets_kind":"best_of","sets_n":3}')::text$$);
select _t(:'W', 'lancer KO 13', $$select lancer_tournoi(current_setting('t.ko13')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":5}')::text$$);
select _t(:'W', 'lancer KO 2', $$select lancer_tournoi(current_setting('t.ko2')::uuid, '{"variant":"libre","start_score":701,"legs_kind":"first_to","legs_n":1}')::text$$);
select _t(:'W', 'poules 13 : 7 poules refusé (2 min/poule)', $$select lancer_tournoi(current_setting('t.p13')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}', 7)::text$$, 'choisissez entre 1 et 6');
select _t(:'W', 'poules 5 : 3 qualifiés pour poules de 2 refusé', $$select lancer_tournoi(current_setting('t.p5')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}', 2)::text$$, 'impossible');
select _t(:'W', 'lancer poules 13 en 4 poules', $$select lancer_tournoi(current_setting('t.p13')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}', 4)::text$$);
select _t(:'W', 'lancer poules 5 en 1 poule', $$select lancer_tournoi(current_setting('t.p5')::uuid, '{"variant":"501","legs_kind":"best_of","legs_n":3}', 1)::text$$);
-- Vérifications de l'arbre
\echo --- arbres : taille, exemptions, matchs prêts
select t.name || ' : matchs=' || count(m.*) || ' tours=' || max(m.round_no)
  || ' byes=' || count(*) filter (where m.status='bye')
  || ' prêts=' || count(*) filter (where m.status='ready')
  || ' attente=' || count(*) filter (where m.status='waiting')
  || ' 3e=' || count(*) filter (where m.is_third_place)
from tournaments t join tournament_matches m on m.tournament_id=t.id where t.format='knockout' group by t.name order by t.name;
\echo --- aucun match d exemption vide, aucun joueur deux fois dans un même tour
select 'bye vide : ' || count(*) from tournament_matches where status='bye' and winner_entry is null;
select 'doublons par tour : ' || count(*) from (
  select tournament_id, round_no, x from tournament_matches, unnest(array[entry_a, entry_b]) x
  where phase='final' and x is not null and not is_third_place group by 1,2,3 having count(*) > 1) d;
select 'chaque inscrit présent au 1er tour ou exempté et avancé : ' || bool_and(ok) from (
  select e.id, exists (select 1 from tournament_matches m where m.tournament_id=e.tournament_id and m.phase='final' and (m.entry_a=e.id or m.entry_b=e.id)) ok
  from tournament_entries e join tournaments t on t.id=e.tournament_id where t.format='knockout' and t.status='running') z;
\echo --- KO 5 : premier tour
select 'T' || round_no || ' P' || position || ' ' || coalesce((select guest_name || '(' || seed || ')' from tournament_entries where id=entry_a),'—') || ' vs ' || coalesce((select guest_name || '(' || seed || ')' from tournament_entries where id=entry_b),'—') || ' ' || status
from tournament_matches where tournament_id=current_setting('t.ko5')::uuid order by round_no, position;
\echo --- poules
select 'poule ' || pool_no || ' : ' || count(*) || ' joueurs' from tournament_entries where tournament_id=current_setting('t.p13')::uuid group by pool_no order by pool_no;
select 'matchs poules 13 : ' || count(*) || ' (attendu 3+3+3+6=15)' from tournament_matches where tournament_id=current_setting('t.p13')::uuid;
select 'chaque paire une seule fois : ' || (count(*) = count(distinct least(entry_a::text, entry_b::text) || greatest(entry_a::text, entry_b::text))) from tournament_matches where phase='pool';
select 'adversaires de la même poule : ' || bool_and(ea.pool_no = eb.pool_no) from tournament_matches m join tournament_entries ea on ea.id=m.entry_a join tournament_entries eb on eb.id=m.entry_b where m.phase='pool';
select 'joueur deux fois dans une journée : ' || count(*) from (select tournament_id, round_no, x from tournament_matches, unnest(array[entry_a, entry_b]) x where phase='pool' group by 1,2,3 having count(*)>1) d;
select 'chacun joue tous les autres de sa poule : ' || bool_and(nb = taille - 1) from (
  select e.id, (select count(*) from tournament_matches m where m.entry_a=e.id or m.entry_b=e.id) nb,
         (select count(*) from tournament_entries x where x.tournament_id=e.tournament_id and x.pool_no=e.pool_no) taille
  from tournament_entries e join tournaments t on t.id=e.tournament_id where t.format='pools' and t.status='running') z;
select 'poules 5 : ' || count(*) || ' matchs (attendu 10), journées ' || max(round_no) from tournament_matches where tournament_id=current_setting('t.p5')::uuid;
-- Lecture
select _t(:'W', 'détail (organisateur) contient le code', $$select (tournoi_detail(current_setting('t.ko8')::uuid)->'tournoi'->>'code' is not null)::text$$);
select _t(:'F', 'détail (membre non inscrit, matchs publics) : spectateur sans code', $$select (tournoi_detail(current_setting('t.ko8')::uuid)->>'role') || ' code=' || coalesce(tournoi_detail(current_setting('t.ko8')::uuid)->'tournoi'->>'code','aucun')$$);
select _t(null, 'détail (visiteur) : spectateur', $$select tournoi_detail(current_setting('t.ko8')::uuid)->>'role'$$);
select set_config('dolina.interne','oui',false); update tournaments set public_matches=false where id=current_setting('t.ko2')::uuid; select set_config('dolina.interne','',false);
select _t(null, 'tournoi à matchs privés : visiteur refusé', $$select tournoi_detail(current_setting('t.ko2')::uuid)->>'role'$$, 'réservé');
select _t(null, 'tournoi non lancé : visiteur refusé', $$select tournoi_detail(current_setting('t.ko1')::uuid)->>'role'$$, 'réservé');
select _t(null, 'accueil : tournois en cours (visiteur)', $$select string_agg(name || ' ' || phase || coalesce(' tour ' || tour || '/' || tours, '') || ' (' || matchs_total || ' matchs)', ' | ' order by name) from tournois_en_cours()$$);
-- Annuler le lancement
select _t(:'F', 'annuler : non-organisateur refusé', $$select annuler_lancement(current_setting('t.ko5')::uuid)::text$$, 'Seul');
select _t(:'W', 'annuler le lancement KO 5', $$select annuler_lancement(current_setting('t.ko5')::uuid)::text$$);
select _t(:'W', 'après annulation : statut et matchs', $$select status || ' / ' || (select count(*) from tournament_matches where tournament_id=t.id) from tournaments t where id=current_setting('t.ko5')::uuid$$);
update tournament_matches set status='live' where tournament_id=current_setting('t.ko13')::uuid and status='ready' and match_no = (select min(match_no) from tournament_matches where tournament_id=current_setting('t.ko13')::uuid and status='ready');
select _t(:'W', 'annuler refusé si un match a commencé', $$select annuler_lancement(current_setting('t.ko13')::uuid)::text$$, 'déjà été joués');
