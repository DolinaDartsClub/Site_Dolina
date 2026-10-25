-- =====================================================================
--  062 · Niveaux des joueurs : jamais montrés aux joueurs
--  Le niveau donné par l'admin à un membre n'est affiché qu'aux admins.
--  Un membre qui organise un tournoi ne voit que les niveaux qu'il a
--  lui-même notés pour ce tournoi (le tirage reste équilibré, sans rien
--  dévoiler). Aucun joueur ne voit jamais son niveau ni celui des autres.
--  À exécuter après le script 061.
-- =====================================================================

create or replace function public.niveaux_tournoi(p_tournoi uuid)
returns table (entry_id uuid, niveau smallint, propre boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur voit les niveaux des joueurs.';
  end if;
  return query
    select e.id,
           case when public.is_admin() then public.niveau_inscrit(e.id)
                else (select ni.niveau from public.niveaux_inscrits ni where ni.entry_id = e.id) end,
           exists (select 1 from public.niveaux_inscrits ni where ni.entry_id = e.id)
    from public.tournament_entries e where e.tournament_id = p_tournoi;
end;
$$;
