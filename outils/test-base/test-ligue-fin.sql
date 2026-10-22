-- Script 050 : ligue — nuls, forfaits entre joueurs, fin de saison
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\set F '33333333-3333-3333-3333-333333333333'
\set G '44444444-4444-4444-4444-444444444444'
\pset tuples_only on
\pset format unaligned
select _t(:'T', 'créer la ligue', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers, est_ligue, cibles_par_poule) values ('Ligue fin', 'pools', 64, 'open', 2, true, 8) returning id::text$$);
select set_config('t.l', (select id::text from tournaments where name = 'Ligue fin'), false);
insert into tournament_entries(tournament_id, profile_id) select current_setting('t.l')::uuid, x from unnest(array[:'T', :'W', :'F', :'G']::uuid[]) x;
select _t(:'T', 'lancer', $$select lancer_tournoi(current_setting('t.l')::uuid, '{"variant":"501","legs_kind":"first_to","legs_n":2}', 1)::text$$);
select _t(:'T', 'visible', $$select definir_visibilite_ligue(current_setting('t.l')::uuid, true)::text$$);
create or replace function _mx(a uuid, b uuid) returns uuid language sql as $$
  select m.id from tournament_matches m join tournament_entries ea on ea.id = m.entry_a join tournament_entries eb on eb.id = m.entry_b
  where m.tournament_id = current_setting('t.l')::uuid and ((ea.profile_id = a and eb.profile_id = b) or (ea.profile_id = b and eb.profile_id = a)) $$;
create or replace function _en(p uuid) returns uuid language sql as $$ select id from tournament_entries where tournament_id = current_setting('t.l')::uuid and profile_id = p $$;
select set_config('t.wf', _mx(:'W', :'F')::text, false);
select set_config('t.fg', _mx(:'F', :'G')::text, false);
select set_config('t.wg', _mx(:'W', :'G')::text, false);
select set_config('t.tw', _mx(:'T', :'W')::text, false);
-- Match nul proposé par Will, accepté par Franck
select _t(:'G', 'non joueur : proposer refusé', $$select proposer_resultat_ligue(current_setting('t.wf')::uuid, 'nul')::text$$, 'Vous ne jouez pas ce match');
select _t(:'W', 'Will propose un nul', $$select proposer_resultat_ligue(current_setting('t.wf')::uuid, 'nul')::text$$);
select _t(:'W', 'deuxième proposition refusée', $$select proposer_resultat_ligue(current_setting('t.wf')::uuid, 'nul')::text$$, 'attend déjà');
select set_config('t.p1', (select id::text from propositions_ligue where match_id = current_setting('t.wf')::uuid and statut = 'en_attente'), false);
select _t(:'W', 'Will ne peut pas accepter sa propre proposition', $$select repondre_proposition_ligue(current_setting('t.p1')::uuid, 'accepter')::text$$, 'adversaire');
select _t(:'F', 'Franck voit la proposition à traiter', $$select (1 / ((propositions_ligue_en_cours(current_setting('t.l')::uuid)->0->>'pour_moi') = 'true')::int)::text$$);
select _t(:'G', 'Gérald ne la voit pas', $$select (1 / (json_array_length(propositions_ligue_en_cours(current_setting('t.l')::uuid)) = 0)::int)::text$$);
select _t(:'F', 'Franck accepte', $$select repondre_proposition_ligue(current_setting('t.p1')::uuid, 'accepter')::text$$);
select _t(:'T', 'match nul enregistré', $$select (1 / ((select status = 'done' and nul and winner_entry is null and not forfeit from tournament_matches where id = current_setting('t.wf')::uuid))::int)::text$$);
select _t(:'T', 'nul : 1 point chacun', $$select (1 / ((select count(*) from classement_poule(current_setting('t.l')::uuid, 1) c where c.entry_id in (_en('22222222-2222-2222-2222-222222222222'), _en('33333333-3333-3333-3333-333333333333')) and c.points = 1 and c.joues = 1) = 2)::int)::text$$);
-- Forfait proposé par Franck (contre Gérald) : refusé puis accepté
select _t(:'F', 'Franck déclare forfait', $$select proposer_resultat_ligue(current_setting('t.fg')::uuid, 'forfait', _en('33333333-3333-3333-3333-333333333333'))::text$$);
select set_config('t.p2', (select id::text from propositions_ligue where match_id = current_setting('t.fg')::uuid and statut = 'en_attente'), false);
select _t(:'G', 'Gérald refuse', $$select repondre_proposition_ligue(current_setting('t.p2')::uuid, 'refuser')::text$$);
select _t(:'T', 'toujours à jouer', $$select (1 / ((select status = 'ready' from tournament_matches where id = current_setting('t.fg')::uuid))::int)::text$$);
select _t(:'G', 'Gérald propose que Franck déclare forfait', $$select proposer_resultat_ligue(current_setting('t.fg')::uuid, 'forfait', _en('33333333-3333-3333-3333-333333333333'))::text$$);
select set_config('t.p3', (select id::text from propositions_ligue where match_id = current_setting('t.fg')::uuid and statut = 'en_attente'), false);
select _t(:'F', 'Franck accepte', $$select repondre_proposition_ligue(current_setting('t.p3')::uuid, 'accepter')::text$$);
select _t(:'T', 'forfait : Gérald 3 pts, Franck 0', $$select (1 / ((select points from classement_poule(current_setting('t.l')::uuid, 1) where entry_id = _en('44444444-4444-4444-4444-444444444444')) = 3
  and (select points from classement_poule(current_setting('t.l')::uuid, 1) where entry_id = _en('33333333-3333-3333-3333-333333333333')) = 1)::int)::text$$);
-- Annulation par l'auteur
select _t(:'W', 'Will propose un nul contre Gérald', $$select proposer_resultat_ligue(current_setting('t.wg')::uuid, 'nul')::text$$);
select set_config('t.p4', (select id::text from propositions_ligue where match_id = current_setting('t.wg')::uuid and statut = 'en_attente'), false);
select _t(:'G', 'Gérald ne peut pas annuler', $$select repondre_proposition_ligue(current_setting('t.p4')::uuid, 'annuler')::text$$, 'auteur');
select _t(:'W', 'Will annule', $$select repondre_proposition_ligue(current_setting('t.p4')::uuid, 'annuler')::text$$);
-- L'organisateur tranche : nul direct, puis remise à jouer
select _t(:'W', 'joueur : nul direct refusé', $$select match_nul_ligue(current_setting('t.tw')::uuid)::text$$, 'Seul l''organisateur');
select _t(:'T', 'admin : nul direct', $$select match_nul_ligue(current_setting('t.tw')::uuid)::text$$);
select _t(:'T', 'remettre à jouer : plus nul', $$select reinitialiser_match(current_setting('t.tw')::uuid)::text$$);
select _t(:'T', 'après remise : à jouer, nul effacé', $$select (1 / ((select status = 'ready' and not nul from tournament_matches where id = current_setting('t.tw')::uuid))::int)::text$$);
-- Fin de saison et rappels
select _t(:'W', 'joueur : fin de saison refusée', $$select definir_fin_saison(current_setting('t.l')::uuid, current_date + 20)::text$$, 'Seul l''organisateur');
select _t(:'T', 'admin : fin de saison', $$select definir_fin_saison(current_setting('t.l')::uuid, current_date + 20)::text$$);
select _t(:'W', 'rappels de Will : 2 matchs restants', $$select (1 / ((select (x->>'restants')::int from json_array_elements(mes_rappels_ligue()) x where x->>'id' = current_setting('t.l')) = 2)::int)::text$$);
select _t(:'W', 'détail : fin_saison et nul', $$select (1 / ((tournoi_detail(current_setting('t.l')::uuid)->'tournoi'->>'fin_saison') = (current_date + 20)::text
  and (select bool_or((m->>'nul')::boolean) from json_array_elements(tournoi_detail(current_setting('t.l')::uuid)->'matchs') m))::int)::text$$);
-- Hors ligue : pas de proposition
select _t(:'T', 'tournoi normal', $$insert into tournaments(name, format, max_participants, status, pool_qualifiers) values ('Normal fin', 'pools', 8, 'open', 2) returning id::text$$);
insert into tournament_entries(tournament_id, profile_id) select (select id from tournaments where name = 'Normal fin'), x from unnest(array[:'T', :'W', :'F']::uuid[]) x;
select _t(:'T', 'lancer normal', $$select lancer_tournoi((select id from tournaments where name = 'Normal fin'), '{"variant":"501","legs_kind":"first_to","legs_n":2}', 1)::text$$);
select set_config('t.n', (select m.id::text from tournament_matches m join tournament_entries e on e.id in (m.entry_a, m.entry_b) where m.tournament_id = (select id from tournaments where name = 'Normal fin') and e.profile_id = :'W' limit 1), false);
select _t(:'W', 'tournoi normal : nul refusé', $$select proposer_resultat_ligue(current_setting('t.n')::uuid, 'nul')::text$$, 'seulement dans la ligue');
select _t(:'T', 'tournoi normal : nul admin refusé', $$select match_nul_ligue(current_setting('t.n')::uuid)::text$$, 'que dans la ligue');

delete from tournaments where name in ('Ligue fin', 'Normal fin');
drop function _mx(uuid, uuid); drop function _en(uuid);
