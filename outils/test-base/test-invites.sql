-- Script 074 : répertoire des joueurs invités
\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
create or replace function _egal(label text, a text, b text) returns text language sql as $f$
  select case when a is not distinct from b then 'PASS  ' || label || '  → ' || coalesce(a, 'null') else 'FAIL  ' || label || '  attendu: ' || coalesce(b, 'null') || '  obtenu: ' || coalesce(a, 'null') end $f$;
create or replace function _anon(q text) returns text language plpgsql as $f$
declare r text; begin execute 'set local role anon'; begin execute q into r; exception when others then r := 'ERREUR ' || sqlerrm; end; execute 'reset role'; return r; end $f$;
select _egal('clé : casse, accents, espaces', cle_nom('  Hélène   DUPRÉ '), 'helene dupre');
-- Partie : un invité ajouté au jeu
select _t(:'W', 'partie avec un invité', $$insert into games (created_by, variant, start_score, mode, legs_kind, legs_n) values ('22222222-2222-2222-2222-222222222222', '501', 501, 'single', 'first_to', 1) returning id::text$$);
select null from set_config('t.g', (select id::text from games where created_by = :'W' order by created_at desc limit 1), false);
insert into game_sides (game_id, side) select current_setting('t.g')::uuid, s from generate_series(1, 2) s;
select _t(:'W', 'joueur invité', $$insert into game_players (game_id, side, guest_name, display_name) values (current_setting('t.g')::uuid, 2, 'Hélène Dupré', 'Hélène Dupré') returning 'ok'$$);
select _egal('invité enregistré', (select nom || ' ×' || nb_utilisations from joueurs_invites where cle = 'helene dupre'), 'Hélène Dupré ×1');
-- Même nom autrement écrit : pas de doublon
select _t(:'W', 'même invité, autre écriture', $$insert into game_players (game_id, side, guest_name, display_name, throw_order) values (current_setting('t.g')::uuid, 2, 'helene  DUPRE', 'helene DUPRE', 2) returning 'ok'$$);
select _egal('pas de doublon, utilisé 2 fois', (select count(*)::text || ' ×' || max(nb_utilisations) from joueurs_invites where cle = 'helene dupre'), '1 ×2');
-- Tournoi : invité et partenaire de doublette
select _t(:'T', 'tournoi en double', $$insert into tournaments(name, format, max_participants, status, team_mode) values ('Doubles I', 'knockout', 16, 'open', 'double') returning id::text$$);
select _t(:'T', 'doublette avec deux invités', $$insert into tournament_entries(tournament_id, guest_name, partner_guest_name, team_name) values ((select id from tournaments where name = 'Doubles I'), 'Marc Invité', 'Paul Invité', 'Les Invités') returning 'ok'$$);
select _egal('les deux invités du tournoi sont gardés', (select string_agg(nom, ', ' order by nom) from joueurs_invites where cle in ('marc invite', 'paul invite')), 'Marc Invité, Paul Invité');
-- Un nom de membre n'est pas enregistré comme invité
select _t(:'W', 'invité au nom d''un membre', $$insert into game_players (game_id, side, guest_name, display_name, throw_order) values (current_setting('t.g')::uuid, 1, 'Will Martin', 'Will Martin', 1) returning 'ok'$$);
select _egal('nom d''un membre : ignoré', (select count(*)::text from joueurs_invites where cle = 'will martin'), '0');
-- Feuille CPARD : noms libres de NOTRE équipe seulement
update teams set captain_id = :'W' where name = 'Dolina 2';
insert into rencontres (team_id, date_match, adversaire, domicile) select id, current_date, 'Adversaire I', true from teams where name = 'Dolina 2';
select _t(:'W', 'feuille', $$select creer_feuille((select id from rencontres where adversaire = 'Adversaire I'), 'A', 4)::text$$);
select null from set_config('t.f', (select id::text from feuilles_match order by created_at desc limit 1), false);
select null from set_config('t.c', (select code from feuilles_match where id = current_setting('t.f')::uuid), false);
select _t(:'W', 'compo A avec deux noms libres', $$select enregistrer_compo(current_setting('t.f')::uuid, 'A', '{"A":{"p":"22222222-2222-2222-2222-222222222222"},"B":{"n":"Karim Benali"},"C":{"n":"Loïc Martel"}}')::text$$);
select _egal('noms libres de notre équipe gardés, avec l''équipe', (select string_agg(i.nom || ' (' || t.name || ')', ', ' order by i.nom) from joueurs_invites i join teams t on t.id = i.team_id where i.cle in ('karim benali', 'loic martel')), 'Karim Benali (Dolina 2), Loïc Martel (Dolina 2)');
select case when _anon(format($q$select enregistrer_compo(null, 'E', '{"E":{"n":"Adverse Inconnu"}}', %L)::text$q$, current_setting('t.c'))) not like 'ERREUR%' then 'PASS  compo adverse saisie' else 'FAIL  compo adverse' end;
select _egal('joueurs adverses non enregistrés', (select count(*)::text from joueurs_invites where cle = 'adverse inconnu'), '0');
-- Droits
select _t(:'W', 'un membre lit le répertoire', $$select count(*)::text from joueurs_invites$$);
select case when _anon('select count(*)::text from joueurs_invites') in ('0') or _anon('select count(*)::text from joueurs_invites') like 'ERREUR%' then 'PASS  visiteur : répertoire invisible' else 'FAIL  visiteur voit les invités' end;
select _t(:'W', 'un membre ne supprime pas', $$delete from joueurs_invites where cle = 'karim benali' returning 'supprimé'$$);
select _egal('toujours là', (select count(*)::text from joueurs_invites where cle = 'karim benali'), '1');
select _t(:'T', 'admin renomme', $$update joueurs_invites set nom = 'Karim Ben Ali', cle = cle_nom('Karim Ben Ali') where cle = 'karim benali' returning nom$$);
select _t(:'T', 'admin supprime', $$delete from joueurs_invites where cle = 'loic martel' returning 'supprimé'$$);
select _t(:'W', 'noter_invite non appelable directement', $$select noter_invite('Pirate', null)::text$$, 'permission');
