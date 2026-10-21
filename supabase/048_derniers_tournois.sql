-- =====================================================================
--  048 – Derniers tournois du club
--  Liste des tournois publics en cours ou terminés, visible par tous les
--  membres (même ceux qui n'y ont pas participé), avec le vainqueur.
--  Exclus : tournois privés (« Matchs publics » décoché), tournois pas
--  encore lancés, ligue interne masquée.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 047.
--  Peut être relancé sans risque.
-- =====================================================================

create or replace function public.derniers_tournois(p_decalage int default 0, p_limite int default 6)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.quand desc), '[]'::json)
  from (
    select t.id, t.name, t.format, t.team_mode, t.status, t.pool_qualifiers, t.est_ligue,
           t.started_at, t.finished_at, coalesce(t.finished_at, t.started_at) as quand,
           (select count(*) from public.tournament_entries e where e.tournament_id = t.id) as inscrits,
           (select count(*) from public.tournament_matches m where m.tournament_id = t.id and m.status = 'done') as matchs_joues,
           (select count(*) from public.tournament_matches m where m.tournament_id = t.id and m.status <> 'bye') as matchs_total,
           (select public.nom_inscrit(e) from public.tournament_matches m join public.tournament_entries e on e.id = m.winner_entry
            where m.tournament_id = t.id and m.phase = 'final' and not m.is_third_place and m.next_match_id is null
              and t.status = 'finished' limit 1) as vainqueur
    from public.tournaments t
    where t.status in ('running', 'finished') and t.public_matches
      and not (t.est_ligue and not t.ligue_visible)
    order by coalesce(t.finished_at, t.started_at) desc nulls last
    limit least(greatest(coalesce(p_limite, 6), 1), 30) offset greatest(coalesce(p_decalage, 0), 0)
  ) x
  where public.is_active_member();
$$;
revoke execute on function public.derniers_tournois(int, int) from public, anon;
grant execute on function public.derniers_tournois(int, int) to authenticated;

notify pgrst, 'reload schema';
