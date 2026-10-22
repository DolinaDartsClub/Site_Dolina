-- =====================================================================
--  052 – Tableau B pour les non-qualifiés des poules
--  À la création d'un tournoi en poules, l'organisateur peut prévoir un
--  « tableau B ». Quand les poules sont terminées, il le crée en un clic :
--  c'est un tournoi à part, où sont inscrits automatiquement tous les
--  non-qualifiés (3e de poule, 4e…). Il choisit son format :
--   - poule unique : chacun contre chacun, le 1er gagne le tableau B
--     (pas de phase finale) ;
--   - élimination directe.
--  Puis il le lance comme un tournoi classique (format des matchs, etc.).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 051.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.tournaments add column if not exists tournoi_b boolean not null default false;
alter table public.tournaments add column if not exists sans_phase_finale boolean not null default false;
alter table public.tournaments add column if not exists parent_id uuid references public.tournaments(id) on delete set null;
create unique index if not exists tournaments_un_tableau_b on public.tournaments(parent_id) where parent_id is not null;

-- Fin du tournoi : poule unique sans phase finale → terminé quand tous les matchs de poule sont joués
create or replace function public.verifier_fin_tournoi(p_tournoi uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournoi;
  if t.sans_phase_finale then
    if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'pool')
       and not exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'pool' and status not in ('done', 'bye')) then
      perform set_config('dolina.interne', 'oui', true);
      update public.tournaments set status = 'finished', finished_at = now() where id = p_tournoi and status = 'running';
    end if;
    return;
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final')
     and not exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final' and status not in ('done', 'bye')) then
    perform set_config('dolina.interne', 'oui', true);
    update public.tournaments set status = 'finished', finished_at = now() where id = p_tournoi and status = 'running';
  end if;
end;
$$;
revoke execute on function public.verifier_fin_tournoi(uuid) from public, anon, authenticated;

-- Pas de phase finale à lancer pour une poule unique « sans phase finale »
create or replace function public.pas_de_finale_sans_phase()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.phase = 'final' and exists (select 1 from public.tournaments where id = new.tournament_id and sans_phase_finale) then
    raise exception 'Ce tableau se joue en poule unique : le premier de la poule gagne, il n''y a pas de phase finale.';
  end if;
  return new;
end;
$$;
drop trigger if exists pas_de_finale_sans_phase on public.tournament_matches;
create trigger pas_de_finale_sans_phase before insert on public.tournament_matches
  for each row execute function public.pas_de_finale_sans_phase();

-- Créer le tableau B avec les non-qualifiés (organisateur ou admin, poules terminées)
create or replace function public.creer_tableau_b(p_tournoi uuid, p_nom text, p_format text, p_troisieme boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  b uuid;
  nb int;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found then raise exception 'Ce tournoi n''existe pas.'; end if;
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut créer le tableau B.';
  end if;
  if t.format <> 'pools' or t.est_ligue then
    raise exception 'Le tableau B existe seulement pour un tournoi en poules.';
  end if;
  if t.status not in ('running', 'finished') then
    raise exception 'Le tournoi n''est pas encore lancé.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'pool' and status not in ('done', 'bye')) then
    raise exception 'Tous les matchs de poule doivent être joués avant de créer le tableau B.';
  end if;
  if exists (select 1 from public.tournaments where parent_id = p_tournoi) then
    raise exception 'Le tableau B de ce tournoi existe déjà.';
  end if;
  if p_format not in ('poule', 'knockout') then
    raise exception 'Choisissez une poule unique ou une élimination directe.';
  end if;

  create temp table if not exists _non_qualifies (entry_id uuid) on commit drop;
  delete from _non_qualifies;
  insert into _non_qualifies
  select c.entry_id from generate_series(1, coalesce(t.pools_count, 1)) k
  cross join lateral public.classement_poule(p_tournoi, k) c
  where c.rang > t.pool_qualifiers;
  select count(*) into nb from _non_qualifies;
  if nb < 2 then
    raise exception 'Il faut au moins 2 non-qualifiés pour un tableau B.';
  end if;

  insert into public.tournaments (name, description, format, team_mode, max_participants, status, pool_qualifiers, pools_count,
                                  third_place, public_matches, show_checkout, match_type, sans_phase_finale, parent_id, created_by)
  values (coalesce(nullif(btrim(p_nom), ''), left(t.name || ' – Tableau B', 80)),
          'Tableau B du tournoi « ' || t.name || ' » : les joueurs non qualifiés pour la phase finale.',
          case when p_format = 'poule' then 'pools' else 'knockout' end, t.team_mode, greatest(nb, 2), 'open',
          case when p_format = 'poule' then least(2, nb) end, case when p_format = 'poule' then 1 end,
          p_format = 'knockout' and coalesce(p_troisieme, false), t.public_matches, t.show_checkout, t.match_type,
          p_format = 'poule', p_tournoi, t.created_by)
  returning id into b;

  insert into public.tournament_entries (tournament_id, profile_id, guest_name, team_name, partner_profile_id, partner_guest_name)
  select b, e.profile_id, e.guest_name, e.team_name, e.partner_profile_id, e.partner_guest_name
  from public.tournament_entries e join _non_qualifies n on n.entry_id = e.id
  order by e.seed;
  return b;
end;
$$;
revoke execute on function public.creer_tableau_b(uuid, text, text, boolean) from public, anon;
grant execute on function public.creer_tableau_b(uuid, text, text, boolean) to authenticated;

-- Derniers tournois : vainqueur d'une poule unique, et lien vers le tournoi principal
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
                   where m.tournament_id = t.id and m.phase = 'final' and not m.is_third_place and m.next_match_id is null limit 1)
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

-- Détail du tournoi : tableau B, tournoi principal
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
      'tournoi_b', t.tournoi_b, 'sans_phase_finale', t.sans_phase_finale,
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
        'format', m.format, 'corrected_at', m.corrected_at, 'nul', m.nul
      ) order by m.match_no)
      from public.tournament_matches m left join public.games g on g.id = m.game_id
      where m.tournament_id = t.id), '[]'::json)
  );
end;
$$;
grant execute on function public.tournoi_detail(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
