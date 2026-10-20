-- =====================================================================
--  044 – Ligue interne du club (en préparation, masquée)
--  Une ligue = un tableau unique où chaque inscrit joue une fois contre
--  chacun des autres pendant la saison (3 points la victoire, 1 la défaite,
--  comme les poules des tournois). Les premiers se qualifient pour le
--  tournoi Master (la phase finale), dont l'admin choisit le nombre de
--  qualifiés (8, 12, 16…) avant de le lancer.
--  Tant que la ligue n'est pas rendue visible, seuls les admins la voient :
--  les inscrits ne la voient pas, elle n'apparaît ni à l'accueil ni avec son code.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 043.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.tournaments add column if not exists est_ligue boolean not null default false;
alter table public.tournaments add column if not exists ligue_visible boolean not null default false;

-- Jusqu'à 32 qualifiés (ligue : un seul tableau, Master à 8, 12, 16…)
alter table public.tournaments drop constraint if exists tournaments_pool_qualifiers_check;
alter table public.tournaments add constraint tournaments_pool_qualifiers_check check (pool_qualifiers between 1 and 32);

-- Seul un admin crée une ligue ou change sa visibilité
create or replace function public.ligue_avant_ecriture()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.est_ligue and not public.is_admin() then
      raise exception 'Seul un admin peut créer la ligue interne.';
    end if;
    if new.est_ligue then
      new.format := 'pools';
      new.team_mode := 'single';
      new.pools_count := 1;
    else
      new.ligue_visible := false;
    end if;
  else
    if (new.est_ligue is distinct from old.est_ligue or new.ligue_visible is distinct from old.ligue_visible)
       and not public.is_admin() then
      raise exception 'Seul un admin peut modifier la ligue interne.';
    end if;
    if new.est_ligue then
      new.format := 'pools';
      new.team_mode := 'single';
      new.pools_count := coalesce(new.pools_count, 1);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ligue_avant_ecriture on public.tournaments;
create trigger ligue_avant_ecriture before insert or update on public.tournaments
  for each row execute function public.ligue_avant_ecriture();

-- Participant : une ligue masquée ne compte pas (sauf pour un admin)
create or replace function public.tournoi_participant(p_tournoi uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.tournament_entries e
    where e.tournament_id = p_tournoi and (e.profile_id = auth.uid() or e.partner_profile_id = auth.uid())
  ) and (
    public.is_admin()
    or not exists (select 1 from public.tournaments t where t.id = p_tournoi and t.est_ligue and not t.ligue_visible)
  );
$$;

-- Rendre la ligue visible aux membres (ou la masquer de nouveau)
create or replace function public.definir_visibilite_ligue(p_tournoi uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Seul un admin peut rendre la ligue visible.';
  end if;
  update public.tournaments set ligue_visible = coalesce(p_visible, false) where id = p_tournoi and est_ligue;
  if not found then
    raise exception 'Cette ligue n''existe pas.';
  end if;
end;
$$;
revoke execute on function public.definir_visibilite_ligue(uuid, boolean) from public, anon;
grant execute on function public.definir_visibilite_ligue(uuid, boolean) to authenticated;

-- Nombre de qualifiés pour la phase finale (le Master), tant qu'elle n'est pas lancée
create or replace function public.definir_qualifies(p_tournoi uuid, p_nombre int)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  plus_petite int;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found then
    raise exception 'Ce tournoi n''existe pas.';
  end if;
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut changer le nombre de qualifiés.';
  end if;
  if t.format <> 'pools' then
    raise exception 'Ce tournoi n''a pas de poules.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final') then
    raise exception 'La phase finale est déjà lancée.';
  end if;
  if p_nombre is null or p_nombre < 1 or p_nombre > 32 then
    raise exception 'Choisissez entre 1 et 32 qualifiés.';
  end if;
  if t.status = 'running' then
    select min(c) into plus_petite from (
      select count(*) c from public.tournament_entries where tournament_id = p_tournoi and pool_no is not null group by pool_no) x;
    if p_nombre > plus_petite then
      raise exception '% qualifiés : impossible, la plus petite poule compte % joueurs.', p_nombre, plus_petite;
    end if;
    if p_nombre * coalesce(t.pools_count, 1) < 2 then
      raise exception 'Il faut au moins 2 qualifiés au total.';
    end if;
  end if;
  perform set_config('dolina.interne', 'oui', true);
  update public.tournaments set pool_qualifiers = p_nombre where id = p_tournoi;
end;
$$;
revoke execute on function public.definir_qualifies(uuid, int) from public, anon;
grant execute on function public.definir_qualifies(uuid, int) to authenticated;

-- Rejoindre avec le code : une ligue masquée reste introuvable
create or replace function public.apercu_tournoi(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  c text := public.normaliser_code(p_code);
  t public.tournaments;
  nb int;
begin
  if not public.is_active_member() then
    raise exception 'Votre compte doit être validé par un admin pour rejoindre un tournoi.';
  end if;
  if c !~ '^[A-Z0-9]{6}$' then
    raise exception 'Le code d''un tournoi compte 6 caractères (lettres et chiffres).';
  end if;
  select * into t from public.tournaments where code = c;
  if not found then
    raise exception 'Aucun tournoi ne correspond au code « % ». Vérifiez-le auprès de l''organisateur.', c;
  end if;
  if t.est_ligue and not t.ligue_visible and not public.is_admin() then
    raise exception 'Aucun tournoi ne correspond au code « % ». Vérifiez-le auprès de l''organisateur.', c;
  end if;
  select count(*) into nb from public.tournament_entries where tournament_id = t.id;
  return json_build_object(
    'id', t.id,
    'code', t.code,
    'name', t.name,
    'description', t.description,
    'format', t.format,
    'team_mode', t.team_mode,
    'status', t.status,
    'inscrits', nb,
    'max_participants', t.max_participants,
    'organisateur', (select public.nom_affiche(p) from public.profiles p where p.id = t.created_by),
    'deja_inscrit', public.tournoi_participant(t.id),
    'organise', t.created_by = auth.uid(),
    'est_ligue', t.est_ligue
  );
end;
$$;

create or replace function public.rejoindre_tournoi(
  p_code text,
  p_team_name text default null,
  p_partner_profile uuid default null,
  p_partner_guest text default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  c text := public.normaliser_code(p_code);
  t public.tournaments;
begin
  if not public.is_active_member() then
    raise exception 'Votre compte doit être validé par un admin pour rejoindre un tournoi.';
  end if;
  select * into t from public.tournaments where code = c;
  if not found then
    raise exception 'Aucun tournoi ne correspond au code « % ». Vérifiez-le auprès de l''organisateur.', c;
  end if;
  if t.est_ligue and not t.ligue_visible and not public.is_admin() then
    raise exception 'Aucun tournoi ne correspond au code « % ». Vérifiez-le auprès de l''organisateur.', c;
  end if;
  if public.tournoi_participant(t.id) then
    raise exception 'Vous êtes déjà inscrit à ce tournoi.';
  end if;
  if t.status = 'draft' then
    raise exception 'Les inscriptions à ce tournoi ne sont pas encore ouvertes.';
  end if;
  if p_partner_profile is not null and not exists (select 1 from public.profiles where id = p_partner_profile and status = 'active') then
    raise exception 'Ce partenaire n''est pas un membre validé.';
  end if;
  -- Les autres vérifications (places, doublons, tournoi commencé) sont faites par le trigger d'inscription
  insert into public.tournament_entries (tournament_id, profile_id, team_name, partner_profile_id, partner_guest_name)
  values (t.id, auth.uid(), p_team_name, p_partner_profile, p_partner_guest);
  return t.id;
end;
$$;

-- Accueil : une ligue masquée n'apparaît pas
create or replace function public.tournois_en_cours()
returns table (
  id uuid, name text, status text, format text, team_mode text, public_matches boolean,
  inscrits int, max_participants int, matchs_total int, matchs_joues int, matchs_en_cours int,
  phase text, tour int, tours int, started_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.status, t.format, t.team_mode, t.public_matches,
    (select count(*)::int from public.tournament_entries e where e.tournament_id = t.id),
    t.max_participants,
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status <> 'bye'),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status = 'done'),
    (select count(*)::int from public.tournament_matches m where m.tournament_id = t.id and m.status = 'live'),
    case when t.status = 'open' then 'inscriptions'
         when exists (select 1 from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final') then 'final'
         else 'pool' end,
    (select min(m.round_no)::int from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final' and m.status in ('ready', 'live', 'waiting') and not m.is_third_place),
    (select max(m.round_no)::int from public.tournament_matches m where m.tournament_id = t.id and m.phase = 'final'),
    t.started_at
  from public.tournaments t
  where t.status in ('running', 'open')
    and not (t.est_ligue and not t.ligue_visible)
  order by (t.status = 'running') desc, coalesce(t.started_at, t.created_at) desc
  limit 12;
$$;
grant execute on function public.tournois_en_cours() to anon, authenticated;

-- Détail du tournoi : indique s'il s'agit de la ligue
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
      'est_ligue', t.est_ligue, 'ligue_visible', t.ligue_visible,
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
        'format', m.format, 'corrected_at', m.corrected_at
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
