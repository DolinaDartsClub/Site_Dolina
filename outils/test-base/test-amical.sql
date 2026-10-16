\pset tuples_only on
\pset format unaligned
\set T '11111111-1111-1111-1111-111111111111'
\set W '22222222-2222-2222-2222-222222222222'
alter table games enable trigger user;
-- Valeur lue en tant que Tony (membre validé)
create or replace function _v(q text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  execute 'set local role authenticated';
  execute q into r;
  execute 'reset role';
  return r;
end $f$;
\set CL 'select (x->>''matchs'') || ''/'' || (x->>''victoires'') from json_array_elements(classement_membres()->''joueurs'') x where x->>''profile_id'' = ''11111111-1111-1111-1111-111111111111'''
\set ST 'select (stats_joueur(''11111111-1111-1111-1111-111111111111'')->>''parties'')'
select 'avant : classement (matchs/victoires) ' || _v(:'CL') || ' | stats parties ' || _v(:'ST');
create table g1 as select g.id from games g join game_players a on a.game_id = g.id and a.profile_id = :'T' join game_players b on b.game_id = g.id and b.profile_id = :'W'
  where g.status = 'finished' and g.mode = 'single' and g.variant = '501' and (select count(*) from game_sides s where s.game_id = g.id) = 2 limit 1;
update games set match_type = 'amical' where id = (select id from g1);
select 'après 1 match amical : classement ' || _v(:'CL') || ' | stats parties ' || _v(:'ST');
update games set match_type = 'ligue' where id = (select id from g1);
select 'en ligue : classement ' || _v(:'CL') || ' | stats parties ' || _v(:'ST');
-- Type figé après la fin pour un non-admin
select _t(:'W', 'Will ne change pas le type d''une partie terminée', $$update games set match_type = 'amical' where id = (select id from g1) returning match_type$$, 'ok');
select 'type après tentative de Will : ' || match_type from games where id = (select id from g1);
-- Contrôle des valeurs
select _t(:'T', 'type inconnu refusé', $$update games set match_type = 'n''importe' where id = (select id from g1)$$, 'violates check');
drop table g1;
