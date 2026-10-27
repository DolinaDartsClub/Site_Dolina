-- =====================================================================
--  066 · Correctif : « Créer le tableau B » (tournoi en poules)
--  Supabase refuse un DELETE sans clause WHERE (« DELETE requires a WHERE
--  clause ») : la table temporaire des non-qualifiés est vidée avec WHERE.
--  À exécuter après le script 065.
-- =====================================================================

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
  delete from _non_qualifies where true;   -- 066 : Supabase refuse un DELETE sans WHERE
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
