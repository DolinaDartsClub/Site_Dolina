-- =====================================================================
--  Accueil : tournois en cours ET tournois aux inscriptions ouvertes
--  À exécuter une fois dans Supabase (après 013) : SQL Editor > New query > Run
--  Visible des visiteurs : nom, format, avancement. Ni code ni inscrits.
-- =====================================================================

drop function if exists public.tournois_en_cours();

create function public.tournois_en_cours()
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
  order by (t.status = 'running') desc, coalesce(t.started_at, t.created_at) desc
  limit 12;
$$;

grant execute on function public.tournois_en_cours() to anon, authenticated;

notify pgrst, 'reload schema';
