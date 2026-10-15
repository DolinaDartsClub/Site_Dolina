\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
\pset tuples_only on
\pset format unaligned
-- Fabrique d'une partie : camps (profil ou invité), volées « camp:score[:fin fléchettes:double] » par manche
create or replace function _partie(variant text, joueurs text[], statut text, gagnant int, manches text[], mode text default 'single', quand timestamptz default now())
returns uuid language plpgsql as $$
declare g uuid; i int; m int; v text; parts text[]; reste int[]; no int[]; c int; sc int; depart int;
begin
  depart := case variant when '301' then 301 when '501' then 501 else 701 end;
  insert into games(created_by, variant, start_score, mode, legs_kind, legs_n, status, winner_side, finished_at)
  values ('11111111-1111-1111-1111-111111111111', variant, depart, mode, 'first_to', 2, statut, gagnant, quand) returning id into g;
  for i in 1..array_length(joueurs, 1) loop
    insert into game_sides(game_id, side) values (g, i);
    if joueurs[i] ~ '^[0-9a-f-]{36}$' then insert into game_players(game_id, side, profile_id) values (g, i, joueurs[i]::uuid);
    else insert into game_players(game_id, side, guest_name) values (g, i, joueurs[i]); end if;
  end loop;
  for m in 1..coalesce(array_length(manches, 1), 0) loop
    reste := array_fill(depart, array[4]); no := array_fill(0, array[4]);
    foreach v in array string_to_array(manches[m], ' ') loop
      parts := string_to_array(v, ':'); c := parts[1]::int; sc := parts[2]::int; no[c] := no[c] + 1;
      insert into visits(game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double)
      values (g, 1, m, no[c], c, sc, reste[c], coalesce(parts[3], '') = 'b', array_length(parts, 1) >= 4,
              case when array_length(parts, 1) >= 4 then parts[4]::int else 3 end,
              case when array_length(parts, 1) >= 5 then parts[5]::int else 0 end);
      if coalesce(parts[3], '') <> 'b' then reste[c] := reste[c] - sc; end if;
    end loop;
  end loop;
  return g;
end $$;
alter table games disable trigger user;
create or replace function _egal(uid text, label text, q text, attendu text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  execute q into r;
  execute 'reset role';
  return case when r = attendu then 'PASS  ' || label || '  → ' || r else 'FAIL  ' || label || '  attendu: ' || attendu || '  obtenu: ' || r end;
end $f$;
-- Partie de référence : Tony bat Will 2-1 en 501
select _partie('501', array[:'T', :'W'], 'finished', 1, array[
  '1:100 2:60 1:140 2:60 1:180 2:60 1:81:f:3:1',
  '2:180 1:45 2:180 1:26 2:141:f:3:1',
  '1:180 2:100 1:180 2:100 1:141:f:3:1']);
select _egal(:'T', 'référence : moyenne, 9 premières, double, records', $$
  select format('parties=%s V=%s D=%s manches=%s-%s moy=%s 9=%s dbl=%s/%s finish=%s 180=%s 140=%s 100=%s court501=%s',
    s->>'parties', s->>'victoires', s->>'defaites', s->>'manches_gagnees', s->>'manches_perdues',
    round((s->>'points')::numeric / (s->>'flechettes')::numeric * 3, 1), round((s->>'points_9')::numeric / (s->>'flechettes_9')::numeric * 3, 1),
    s->>'finishs', s->>'flechettes_double', s->>'meilleur_finish', s->>'nb_180', s->>'nb_140', s->>'nb_100', s->>'manche_courte_501')
  from stats_joueur('11111111-1111-1111-1111-111111111111') s$$, 'parties=1 V=1 D=0 manches=2-1 moy=119.2 9=124.0 dbl=2/2 finish=141 180=3 140=2 100=1 court501=9');
-- Parties qui comptent / ne comptent pas
select _partie('501', array[:'T', 'Invité Max'], 'finished', 2, array['1:60 2:180 1:60 2:180 1:60 2:141:f:3:2']);         -- défaite contre un invité : compte
select _partie('301', array[:'T', :'W', 'Invité Léa'], 'finished', 3, array['1:100 2:100 3:180 1:41 2:41 3:121:f:3:1']);   -- 1v1v1 perdue : compte (défaite)
select _partie('501', array[:'T'], 'finished', 1, array['1:180 1:180 1:141:f:3:1']);                                        -- seul : ne compte pas
select _partie('501', array[:'T', :'W'], 'abandoned', null, array['1:180 2:180']);                                         -- abandonnée : non
select _partie('libre', array[:'T', :'W'], 'finished', 1, array['1:180 2:180']);                                           -- score libre : non
select _partie('501', array[:'T', :'W'], 'live', null, array['1:180']);                                                    -- en cours : non
select _partie('501', array[:'T', 'X', :'W', 'Y'], 'finished', 1, array['1:180 3:60 2:60 4:60'], 'double');                -- double : non (onglet Doublettes)
select _partie('501', array[:'T', :'W'], 'finished', 1, array['1:180 2:180 1:180 2:180 1:141:f:3:1'], 'single', '2025-03-01'); -- saison précédente
select _egal(:'T', 'toutes périodes : parties / bilan', $$select format('parties=%s bilan=%s V=%s D=%s', s->>'parties', s->>'parties_bilan', s->>'victoires', s->>'defaites') from stats_joueur('11111111-1111-1111-1111-111111111111') s$$, 'parties=4 bilan=4 V=2 D=2');
select _egal(:'T', 'saison 2026-2027 (depuis le 1er septembre)', $$select format('parties=%s V=%s', s->>'parties', s->>'victoires') from stats_joueur('11111111-1111-1111-1111-111111111111', '2026-09-01') s$$, 'parties=3 V=1');
select _egal(:'T', 'filtre 301', $$select format('parties=%s D=%s court301=%s', s->>'parties', s->>'defaites', coalesce(s->>'manche_courte_301', 'aucune')) from stats_joueur('11111111-1111-1111-1111-111111111111', null, null, '301') s$$, 'parties=1 D=1 court301=aucune');
select _t(:'T', 'évolution : une moyenne par partie', $$select json_array_length(s->'evolution')::text from stats_joueur('11111111-1111-1111-1111-111111111111') s$$);
select _t(:'W', 'Will voit les stats de Tony (membres)', $$select (s->'joueur'->>'nom') from stats_joueur('11111111-1111-1111-1111-111111111111') s$$);
select _t(null, 'visiteur refusé', $$select stats_joueur('11111111-1111-1111-1111-111111111111')::text$$, 'réservées aux membres');
select _t('55555555-5555-5555-5555-555555555555', 'compte en attente refusé', $$select stats_joueur('11111111-1111-1111-1111-111111111111')::text$$, 'réservées aux membres');
select _t(:'T', 'jeu inconnu refusé', $$select stats_joueur('11111111-1111-1111-1111-111111111111', null, null, 'libre')::text$$, 'Jeu inconnu');
alter table games enable trigger user;
