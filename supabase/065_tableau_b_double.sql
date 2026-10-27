-- =====================================================================
--  065 · Tableau B en double élimination (tournoi à élimination directe)
--  Option choisie à la création. Chaque joueur éliminé du tableau A
--  rejoint le tableau B au tour qui correspond à son élimination, comme
--  le « losers bracket » de Challonge :
--   - tour 1 du B : les perdants du 1er tour du A s'affrontent ;
--   - puis, à chaque tour du A, ses perdants rejoignent les vainqueurs du B
--     (ordre inversé pour éviter de rejouer tout de suite le même adversaire) ;
--   - le B se termine par sa propre finale : il a son propre vainqueur
--     (pas de grande finale contre le vainqueur du A).
--  Le finaliste du A ne descend pas dans le B (il est 2e du A). Avec un
--  tableau B, il n'y a pas de match pour la 3e place dans le A.
--  Les matchs du B ont leur propre format (choisi au lancement).
--  À exécuter après le script 064.
-- =====================================================================

alter table public.tournaments add column if not exists b_double boolean not null default false;
alter table public.tournaments add column if not exists format_b jsonb;
alter table public.tournament_matches add column if not exists tableau_b boolean not null default false;

-- Un match du B dont tous les « fournisseurs » sont connus mais à qui il manque
-- un joueur (exemption au 1er tour du A) : le joueur présent passe directement
create or replace function public.b_resoudre(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  x public.tournament_matches;
  seul uuid;
begin
  if p_match is null then return; end if;
  select * into x from public.tournament_matches where id = p_match;
  if not found or not x.tableau_b or x.status <> 'waiting' then return; end if;
  if exists (select 1 from public.tournament_matches f
             where (f.next_match_id = p_match or f.loser_match_id = p_match) and f.status not in ('done', 'bye')) then
    return;                                   -- un joueur peut encore arriver
  end if;
  if x.entry_a is not null and x.entry_b is not null then return; end if;
  seul := coalesce(x.entry_a, x.entry_b);
  update public.tournament_matches set status = 'bye', winner_entry = seul where id = p_match;
  if seul is not null then
    perform public.faire_avancer(p_match);    -- place le joueur et résout la suite
  else
    perform public.b_resoudre(x.next_match_id);
  end if;
end;
$$;

create or replace function public.faire_avancer(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.tournament_matches;
  perdant uuid;
begin
  select * into m from public.tournament_matches where id = p_match;
  if m.winner_entry is null then return; end if;
  if m.next_match_id is not null then
    if m.next_slot = 'a' then
      update public.tournament_matches set entry_a = m.winner_entry where id = m.next_match_id;
    else
      update public.tournament_matches set entry_b = m.winner_entry where id = m.next_match_id;
    end if;
    update public.tournament_matches set status = 'ready'
     where id = m.next_match_id and status = 'waiting' and entry_a is not null and entry_b is not null;
  end if;
  if m.loser_match_id is not null and m.status = 'done' then
    perdant := case when m.winner_entry = m.entry_a then m.entry_b else m.entry_a end;
    if m.loser_slot = 'a' then
      update public.tournament_matches set entry_a = perdant where id = m.loser_match_id;
    else
      update public.tournament_matches set entry_b = perdant where id = m.loser_match_id;
    end if;
    update public.tournament_matches set status = 'ready'
     where id = m.loser_match_id and status = 'waiting' and entry_a is not null and entry_b is not null;
  end if;
  -- 065 : tableau B en double élimination (exemptions quand un perdant n'arrive jamais)
  perform public.b_resoudre(m.next_match_id);
  perform public.b_resoudre(m.loser_match_id);
end;
$$;

create or replace function public.creer_tableau_b_double(p_tournoi uuid, p_format jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  tours int;
  taille int;
  no int;
  r int := 0;                -- tour du B
  j int; p int; c int;
  prec uuid[];               -- matchs du tour précédent du B
  cour uuid[];
  m uuid;
  pa uuid[];                 -- matchs d'un tour du A
begin
  select max(round_no) into tours from public.tournament_matches
   where tournament_id = p_tournoi and phase = 'final' and not tableau_b and not is_third_place;
  if coalesce(tours, 0) < 2 then return; end if;     -- 2 joueurs : pas de tableau B
  taille := (2 ^ tours)::int;
  select coalesce(max(match_no), 0) + 1 into no from public.tournament_matches where tournament_id = p_tournoi;

  -- Tour 1 du B : perdants du 1er tour du A, deux par deux
  r := 1; c := taille / 4; cour := '{}';
  for p in 1..c loop
    insert into public.tournament_matches (tournament_id, match_no, phase, round_no, position, tableau_b, format)
    values (p_tournoi, no, 'final', r, p, true, p_format) returning id into m;
    cour := cour || m; no := no + 1;
  end loop;
  select array_agg(id order by position) into pa from public.tournament_matches
   where tournament_id = p_tournoi and phase = 'final' and not tableau_b and round_no = 1;
  for p in 1..array_length(pa, 1) loop
    update public.tournament_matches set loser_match_id = cour[(p + 1) / 2], loser_slot = case when p % 2 = 1 then 'a' else 'b' end
    where id = pa[p];
  end loop;
  prec := cour;

  for j in 2..tours - 1 loop
    -- Tour « d'entrée » : vainqueurs du B contre perdants du tour j du A (ordre inversé)
    r := r + 1; c := taille / (2 ^ j)::int; cour := '{}';
    for p in 1..c loop
      insert into public.tournament_matches (tournament_id, match_no, phase, round_no, position, tableau_b, format)
      values (p_tournoi, no, 'final', r, p, true, p_format) returning id into m;
      cour := cour || m; no := no + 1;
      update public.tournament_matches set next_match_id = m, next_slot = 'a' where id = prec[p];
    end loop;
    select array_agg(id order by position) into pa from public.tournament_matches
     where tournament_id = p_tournoi and phase = 'final' and not tableau_b and round_no = j;
    for p in 1..c loop
      update public.tournament_matches set loser_match_id = cour[c + 1 - p], loser_slot = 'b' where id = pa[p];
    end loop;
    prec := cour;
    -- Tour « de réduction » : les vainqueurs du B s'affrontent deux par deux
    r := r + 1; c := c / 2; cour := '{}';
    for p in 1..c loop
      insert into public.tournament_matches (tournament_id, match_no, phase, round_no, position, tableau_b, format)
      values (p_tournoi, no, 'final', r, p, true, p_format) returning id into m;
      cour := cour || m; no := no + 1;
    end loop;
    for p in 1..array_length(prec, 1) loop
      update public.tournament_matches set next_match_id = cour[(p + 1) / 2], next_slot = case when p % 2 = 1 then 'a' else 'b' end
      where id = prec[p];
    end loop;
    prec := cour;
  end loop;

  -- Exemptions du 1er tour du A : leurs places dans le B se résolvent tout de suite
  perform public.b_resoudre(id) from public.tournament_matches
   where tournament_id = p_tournoi and tableau_b order by round_no, position;
end;
$$;
revoke execute on function public.creer_tableau_b_double(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.b_resoudre(uuid) from public, anon, authenticated;

drop function if exists public.lancer_tournoi(uuid, jsonb, int);
create or replace function public.lancer_tournoi(p_tournoi uuid, p_format jsonb, p_poules int default null, p_format_b jsonb default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  f jsonb := public.verifier_format_match(p_format);
  n int;
  tirage uuid[];
  plus_petite int;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found or not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut le lancer.';
  end if;
  if t.status not in ('draft', 'open') then
    raise exception 'Ce tournoi est déjà lancé.';
  end if;

  -- Tirage au sort ; dans la ligue interne (063), les inscrits sont d'abord rangés par niveau :
  -- niveau 1 (meilleurs) en premier, sans niveau à la fin, tirage au sort à niveau égal
  if t.format = 'pools' and t.est_ligue then
    select array_agg(e.id order by public.niveau_inscrit(e.id) nulls last, random()) into tirage
    from public.tournament_entries e where e.tournament_id = p_tournoi;
  else
    select array_agg(id order by random()) into tirage from public.tournament_entries where tournament_id = p_tournoi;
  end if;
  n := coalesce(array_length(tirage, 1), 0);

  perform set_config('dolina.interne', 'oui', true);
  update public.tournament_entries set pool_no = null, seed = null where tournament_id = p_tournoi;
  delete from public.tournament_matches where tournament_id = p_tournoi;

  if t.format = 'knockout' then
    if n < 2 then
      raise exception 'Il faut au moins 2 participants pour lancer le tournoi.';
    end if;
    for i in 1..n loop
      update public.tournament_entries set seed = i where id = tirage[i];
    end loop;
    perform public.creer_arbre(p_tournoi, tirage, 1, t.third_place and not t.b_double);
    -- 065 : tableau B en double élimination (format à part, sinon celui du A)
    if t.b_double and n >= 3 then
      perform public.creer_tableau_b_double(p_tournoi, public.verifier_format_match(coalesce(p_format_b, t.format_b, p_format)));
    end if;
    update public.tournaments set status = 'running', started_at = now(), final_format = f, pools_count = null where id = p_tournoi;
  else
    if n < 3 then
      raise exception 'Il faut au moins 3 participants pour un tournoi avec poules.';
    end if;
    p_poules := coalesce(p_poules, t.pools_count, greatest(1, ceil(n / 4.0)::int));
    if p_poules < 1 or p_poules > 16 or n / p_poules < 2 then
      raise exception 'Avec % participants, choisissez entre 1 et % poules (2 joueurs minimum par poule).', n, least(16, n / 2);
    end if;
    plus_petite := n / p_poules;
    if t.pool_qualifiers > plus_petite then
      raise exception '% qualifiés par poule : impossible avec des poules de % joueurs. Réduisez le nombre de qualifiés ou de poules.', t.pool_qualifiers, plus_petite;
    end if;
    if t.pool_qualifiers * p_poules < 2 then
      raise exception 'Il faut au moins 2 qualifiés au total pour la phase finale.';
    end if;
    perform public.creer_poules(p_tournoi, tirage, p_poules);
    update public.tournaments set status = 'running', started_at = now(), pool_format = f, pools_count = p_poules where id = p_tournoi;
  end if;
end;
$$;

create or replace function public.tournoi_detail(p_tournoi uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  t public.tournaments;
  role text;
begin
  select * into t from public.tournaments where id = p_tournoi;
  if not found then
    raise exception 'Ce tournoi n''existe pas.';
  end if;
  role := case
    when public.tournoi_organisateur(p_tournoi) then 'organisateur'
    when public.tournoi_participant(p_tournoi) then 'participant'
    when t.status in ('running', 'finished') and t.public_matches then 'spectateur'
  end;
  if role is null then
    raise exception 'Ce tournoi est réservé à ses participants. Rejoignez-le avec son code.';
  end if;
  if t.est_ligue and not t.ligue_visible and not public.is_admin() then
    raise exception 'Cette ligue n''est pas encore ouverte aux membres.';
  end if;

  return json_build_object(
    'role', role,
    'tournoi', json_build_object(
      'id', t.id, 'code', case when role <> 'spectateur' then t.code end,
      'name', t.name, 'description', t.description, 'team_mode', t.team_mode, 'format', t.format,
      'max_participants', t.max_participants, 'pools_count', t.pools_count, 'pool_qualifiers', t.pool_qualifiers,
      'third_place', t.third_place, 'public_matches', t.public_matches, 'show_checkout', t.show_checkout, 'status', t.status,
      'pool_format', t.pool_format, 'final_format', t.final_format, 'cibles_par_poule', t.cibles_par_poule, 'cibles_finale', t.cibles_finale,
      'est_ligue', t.est_ligue, 'ligue_visible', t.ligue_visible, 'fin_saison', t.fin_saison,
      'tournoi_b', t.tournoi_b, 'sans_phase_finale', t.sans_phase_finale, 'b_double', t.b_double, 'format_b', t.format_b,
      'parent', (select json_build_object('id', pt.id, 'name', pt.name) from public.tournaments pt where pt.id = t.parent_id),
      'tableau_b', (select json_build_object('id', bt.id, 'name', bt.name, 'status', bt.status) from public.tournaments bt where bt.parent_id = t.id limit 1),
      'created_by', t.created_by, 'created_at', t.created_at, 'started_at', t.started_at, 'finished_at', t.finished_at,
      'organisateur', (select public.nom_affiche(p) from public.profiles p where p.id = t.created_by)
    ),
    'inscrits', coalesce((
      select json_agg(json_build_object(
        'id', e.id, 'profile_id', e.profile_id, 'partner_profile_id', e.partner_profile_id,
        'nom', public.nom_inscrit(e),
        'detail', case
          when e.team_name is not null then
            coalesce((select public.nom_affiche(p) from public.profiles p where p.id = e.profile_id), e.guest_name, 'Ancien joueur')
            || ' & ' ||
            coalesce((select public.nom_affiche(p) from public.profiles p where p.id = e.partner_profile_id), e.partner_guest_name, 'Ancien joueur')
          when e.profile_id is null and e.guest_name is not null then 'Invité'
          else '' end,
        'invite', e.profile_id is null,
        'pool_no', e.pool_no, 'seed', e.seed, 'created_at', e.created_at
      ) order by e.created_at)
      from public.tournament_entries e where e.tournament_id = t.id), '[]'::json),
    'matchs', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'match_no', m.match_no, 'phase', m.phase, 'pool_no', m.pool_no, 'round_no', m.round_no,
        'position', m.position, 'is_third_place', m.is_third_place, 'entry_a', m.entry_a, 'entry_b', m.entry_b,
        'status', m.status, 'winner_entry', m.winner_entry, 'score_a', m.score_a, 'score_b', m.score_b,
        'legs_a', m.legs_a, 'legs_b', m.legs_b, 'forfeit', m.forfeit, 'game_id', m.game_id,
        'next_match_id', m.next_match_id, 'next_slot', m.next_slot, 'loser_match_id', m.loser_match_id, 'loser_slot', m.loser_slot,
        'game_status', g.status, 'game_created_by', g.created_by, 'game_winner_side', g.winner_side,
        'format', m.format, 'corrected_at', m.corrected_at, 'nul', m.nul, 'sans_suite', m.sans_suite, 'tableau_b', m.tableau_b
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;

create or replace function public.derniers_tournois(p_decalage int default 0, p_limite int default 6)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.quand desc), '[]'::json)
  from (
    select t.id, t.name, t.format, t.team_mode, t.status, t.pool_qualifiers, t.est_ligue,
           t.started_at, t.finished_at, coalesce(t.finished_at, t.started_at) as quand,
           (select count(*) from public.tournament_entries e where e.tournament_id = t.id) as inscrits,
           (select count(*) from public.tournament_matches m where m.tournament_id = t.id and m.status = 'done') as matchs_joues,
           (select count(*) from public.tournament_matches m where m.tournament_id = t.id and m.status <> 'bye') as matchs_total,
           case when t.status <> 'finished' then null
                when t.sans_phase_finale then
                  (select public.nom_inscrit(e) from public.classement_poule(t.id, 1) c join public.tournament_entries e on e.id = c.entry_id where c.rang = 1)
                else
                  (select public.nom_inscrit(e) from public.tournament_matches m join public.tournament_entries e on e.id = m.winner_entry
                   where m.tournament_id = t.id and m.phase = 'final' and not m.is_third_place and not m.tableau_b and m.next_match_id is null limit 1)
           end as vainqueur,
           (select pt.name from public.tournaments pt where pt.id = t.parent_id) as parent_nom
    from public.tournaments t
    where t.status in ('running', 'finished') and t.public_matches
      and not (t.est_ligue and not t.ligue_visible)
    order by coalesce(t.finished_at, t.started_at) desc nulls last
    limit least(greatest(coalesce(p_limite, 6), 1), 30) offset greatest(coalesce(p_decalage, 0), 0)
  ) x
  where public.is_active_member();
$$;

grant execute on function public.lancer_tournoi(uuid, jsonb, int, jsonb) to authenticated;

-- Format d'un tour du tableau A : ne touche pas aux matchs du tableau B (même numéro de tour)
create or replace function public.definir_format_tour(p_tournoi uuid, p_tour int, p_format jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  f jsonb := public.verifier_format_match(p_format);
  n int;
begin
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut changer le format des matchs.';
  end if;
  if not exists (select 1 from public.tournaments where id = p_tournoi and status = 'running') then
    raise exception 'Le tournoi n''est pas en cours.';
  end if;
  update public.tournament_matches set format = f
   where tournament_id = p_tournoi and phase = 'final' and round_no = p_tour and not tableau_b
     and status in ('waiting', 'ready') and game_id is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Tous les matchs de ce tour ont déjà commencé : le format ne peut plus changer.';
  end if;
  return n;
end;
$$;
